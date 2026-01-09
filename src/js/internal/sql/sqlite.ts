import type * as BunSQLiteModule from "bun:sqlite";
import type { BaseQueryHandle, Query, SQLQueryResultMode } from "./query";
import type { ArrayType, DatabaseAdapter, OnConnected, SQLArrayParameter, SQLHelper, SQLResultArray } from "./shared";

const { SQLHelper, SQLResultArray, buildDefinedColumnsAndQuery } = require("internal/sql/shared");
const {
  Query,
  SQLQueryResultMode,
  symbols: { _strings, _values },
} = require("internal/sql/query");
const { SQLiteError } = require("internal/sql/errors");

let lazySQLiteModule: typeof BunSQLiteModule;
function getSQLiteModule() {
  if (!lazySQLiteModule) {
    lazySQLiteModule = require("../../bun/sqlite.ts");
  }
  return lazySQLiteModule;
}

const enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  in = 4,
  none = -1,
}

interface SQLParsedInfo {
  command: SQLCommand;
  lastToken?: string;
  canReturnRows: boolean;
}

function commandToString(command: SQLCommand, lastToken?: string): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.in:
    case SQLCommand.where:
      if (lastToken) return lastToken;
      return "WHERE";
    default:
      if (lastToken) return lastToken;
      return "";
  }
}

/**
 * Parse the SQL query and return the command and the last token
 * @param query - The SQL query to parse
 * @param partial - Whether to stop on the first command we find
 * @returns The command, the last token, and whether it can return rows
 */
function parseSQLQuery(query: string, partial: boolean = false): SQLParsedInfo {
  const text = query.toUpperCase().trim();
  const text_len = text.length;

  let token = "";
  let command = SQLCommand.none;
  let lastToken = "";
  let canReturnRows = false;
  let quoted: false | "'" | '"' = false;
  // we need to reverse search so we find the closest command to the parameter
  for (let i = text_len - 1; i >= 0; i--) {
    const char = text[i];
    switch (char) {
      case " ":
      case "\n":
      case "\t":
      case "\r":
      case "\f":
      case "\v": {
        switch (token) {
          case "INSERT": {
            if (command === SQLCommand.none) {
              command = SQLCommand.insert;
            }
            lastToken = token;
            token = "";
            if (partial) {
              return { command: SQLCommand.insert, lastToken, canReturnRows };
            }
            continue;
          }
          case "UPDATE": {
            if (command === SQLCommand.none) {
              command = SQLCommand.update;
            }
            lastToken = token;
            token = "";
            if (partial) {
              return { command: SQLCommand.update, lastToken, canReturnRows };
            }
            continue;
          }
          case "WHERE": {
            if (command === SQLCommand.none) {
              command = SQLCommand.where;
            }
            lastToken = token;
            token = "";
            if (partial) {
              return { command: SQLCommand.where, lastToken, canReturnRows };
            }
            continue;
          }
          case "SET": {
            if (command === SQLCommand.none) {
              command = SQLCommand.updateSet;
            }
            lastToken = token;
            token = "";
            if (partial) {
              return { command: SQLCommand.updateSet, lastToken, canReturnRows };
            }
            continue;
          }
          case "IN": {
            if (command === SQLCommand.none) {
              command = SQLCommand.in;
            }
            lastToken = token;
            token = "";
            if (partial) {
              return { command: SQLCommand.in, lastToken, canReturnRows };
            }
            continue;
          }
          case "SELECT":
          case "PRAGMA":
          case "WITH":
          case "EXPLAIN":
          case "RETURNING": {
            lastToken = token;
            canReturnRows = true;
            token = "";
            continue;
          }
          default: {
            lastToken = token;
            token = "";
            continue;
          }
        }
      }
      default: {
        // skip quoted commands
        if (char === '"' || char === "'") {
          if (quoted === char) {
            quoted = false;
          } else {
            quoted = char;
          }
          continue;
        }
        if (!quoted) {
          token = char + token;
        }
      }
    }
  }
  if (token) {
    lastToken = token;
    switch (token) {
      case "INSERT":
        if (command === SQLCommand.none) {
          command = SQLCommand.insert;
        }
        break;
      case "UPDATE":
        if (command === SQLCommand.none) command = SQLCommand.update;
        break;
      case "WHERE":
        if (command === SQLCommand.none) {
          command = SQLCommand.where;
        }
        break;
      case "SET":
        if (command === SQLCommand.none) {
          command = SQLCommand.updateSet;
        }
        break;
      case "IN":
        if (command === SQLCommand.none) {
          command = SQLCommand.in;
        }
        break;
      case "SELECT":
      case "PRAGMA":
      case "WITH":
      case "EXPLAIN":
      case "RETURNING": {
        canReturnRows = true;
        break;
      }
      default:
        command = SQLCommand.none;
        break;
    }
  }
  return { command, lastToken, canReturnRows };
}

class SQLiteQueryHandle implements BaseQueryHandle<BunSQLiteModule.Database> {
  private mode = SQLQueryResultMode.objects;

  private readonly sql: string;
  private readonly values: unknown[];
  private readonly parsedInfo: SQLParsedInfo;

  public constructor(sql: string, values: unknown[]) {
    this.sql = sql;
    this.values = values;
    // Parse the SQL query once when creating the handle
    this.parsedInfo = parseSQLQuery(sql);
  }

  setMode(mode: SQLQueryResultMode) {
    this.mode = mode;
  }

  run(db: BunSQLiteModule.Database, query: Query<any, any>) {
    if (!db) {
      throw new SQLiteError("SQLite database not initialized", {
        code: "SQLITE_CONNECTION_CLOSED",
        errno: 0,
      });
    }

    const { sql, values, mode, parsedInfo } = this;
    try {
      const command = parsedInfo.command;
      // For SELECT queries, we need to use a prepared statement
      // For other queries, we can check if there are multiple statements and use db.run() if so
      if (parsedInfo.canReturnRows) {
        // SELECT queries must use prepared statements for results
        const stmt = db.prepare(sql);
        let result: unknown[] | undefined;

        if (mode === SQLQueryResultMode.values) {
          result = stmt.values.$apply(stmt, values);
        } else if (mode === SQLQueryResultMode.raw) {
          result = stmt.raw.$apply(stmt, values);
        } else {
          result = stmt.all.$apply(stmt, values);
        }

        const sqlResult = $isArray(result) ? new SQLResultArray(result) : new SQLResultArray([result]);

        sqlResult.command = commandToString(command, parsedInfo.lastToken);
        sqlResult.count = $isArray(result) ? result.length : 1;

        stmt.finalize();
        query.resolve(sqlResult);
      } else {
        // For INSERT/UPDATE/DELETE/CREATE etc., use db.run() which handles multiple statements natively
        const changes = db.run.$apply(db, [sql].concat(values));
        const sqlResult = new SQLResultArray();

        sqlResult.command = commandToString(command, parsedInfo.lastToken);
        sqlResult.count = changes.changes;
        sqlResult.lastInsertRowid = changes.lastInsertRowid;

        query.resolve(sqlResult);
      }
    } catch (err) {
      // Convert bun:sqlite errors to SQLiteError
      if (err && typeof err === "object" && "name" in err && err.name === "SQLiteError") {
        // Extract SQLite error properties
        const code = "code" in err ? String(err.code) : "SQLITE_ERROR";
        const errno = "errno" in err ? Number(err.errno) : 1;
        const byteOffset = "byteOffset" in err ? Number(err.byteOffset) : undefined;
        const message = "message" in err ? String(err.message) : "SQLite error";

        throw new SQLiteError(message, { code, errno, byteOffset });
      }
      // Re-throw if it's not a SQLite error
      throw err;
    }
  }
}

class SQLiteAdapter implements DatabaseAdapter<BunSQLiteModule.Database, BunSQLiteModule.Database, SQLiteQueryHandle> {
  public readonly connectionInfo: Bun.SQL.__internal.DefinedSQLiteOptions;
  public db: BunSQLiteModule.Database | null = null;
  public storedError: Error | null = null;
  private _closed: boolean = false;
  public queries: Set<Query<any, any>> = new Set();

  constructor(connectionInfo: Bun.SQL.__internal.DefinedSQLiteOptions) {
    this.connectionInfo = connectionInfo;

    try {
      const SQLiteModule = getSQLiteModule();
      let { filename } = this.connectionInfo;

      if (filename instanceof URL) {
        filename = filename.toString();
      }

      const options: BunSQLiteModule.DatabaseOptions = {};

      if (this.connectionInfo.readonly) {
        options.readonly = true;
      } else {
        options.create = this.connectionInfo.create !== false;
        options.readwrite = true;
      }

      if ("safeIntegers" in this.connectionInfo) {
        options.safeIntegers = this.connectionInfo.safeIntegers;
      }
      if ("strict" in this.connectionInfo) {
        options.strict = this.connectionInfo.strict;
      }

      this.db = new SQLiteModule.Database(filename, options);

      try {
        const onconnect = this.connectionInfo.onconnect;
        if (onconnect) onconnect(null);
      } catch {}
    } catch (err) {
      // Convert bun:sqlite initialization errors to SQLiteError
      if (err && typeof err === "object" && "name" in err && err.name === "SQLiteError") {
        const code = "code" in err ? String(err.code) : "SQLITE_ERROR";
        const errno = "errno" in err ? Number(err.errno) : 1;
        const byteOffset = "byteOffset" in err ? Number(err.byteOffset) : undefined;
        const message = "message" in err ? String(err.message) : "SQLite error";

        this.storedError = new SQLiteError(message, { code, errno, byteOffset });
      } else {
        this.storedError = err as Error;
      }

      this.db = null;
      try {
        const onconnect = this.connectionInfo.onconnect;
        if (onconnect) onconnect(this.storedError ?? (err as Error));
      } catch {}
    }
  }

  createQueryHandle(sql: string, values: unknown[] | undefined | null = []): SQLiteQueryHandle {
    return new SQLiteQueryHandle(sql, values ?? []);
  }
  escapeIdentifier(str: string) {
    return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
  }
  connectionClosedError() {
    return new SQLiteError("Connection closed", {
      code: "ERR_SQLITE_CONNECTION_CLOSED",
      errno: 0,
    });
  }
  notTaggedCallError() {
    return new SQLiteError("Query not called as a tagged template literal", {
      code: "ERR_SQLITE_NOT_TAGGED_CALL",
      errno: 0,
    });
  }
  queryCancelledError() {
    return new SQLiteError("Query cancelled", {
      code: "ERR_SQLITE_QUERY_CANCELLED",
      errno: 0,
    });
  }
  invalidTransactionStateError(message: string) {
    return new SQLiteError(message, {
      code: "ERR_SQLITE_INVALID_TRANSACTION_STATE",
      errno: 0,
    });
  }
  normalizeQuery(strings: string | TemplateStringsArray, values: unknown[], binding_idx = 1): [string, unknown[]] {
    if (typeof strings === "string") {
      // identifier or unsafe query
      return [strings, values || []];
    }

    if (!$isArray(strings)) {
      // we should not hit this path
      throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
    }

    const str_len = strings.length;
    if (str_len === 0) {
      return ["", []];
    }

    let binding_values: any[] = [];
    let query = "";

    for (let i = 0; i < str_len; i++) {
      const string = strings[i];

      if (typeof string === "string") {
        query += string;

        if (values.length > i) {
          const value = values[i];

          if (value instanceof Query) {
            const q = value as Query<any, any>;
            const [sub_query, sub_values] = this.normalizeQuery(q[_strings], q[_values], binding_idx);

            query += sub_query;
            for (let j = 0; j < sub_values.length; j++) {
              binding_values.push(sub_values[j]);
            }
            binding_idx += sub_values.length;
          } else if (value instanceof SQLHelper) {
            // when partial is true we stop on the first command we find
            const { command } = parseSQLQuery(query, true);

            // only selectIn, insert, update, updateSet are allowed
            if (command === SQLCommand.none || command === SQLCommand.where) {
              throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and WHERE IN commands");
            }
            const { columns, value: items } = value as SQLHelper;
            const columnCount = columns.length;
            if (columnCount === 0 && command !== SQLCommand.in) {
              throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
            }
            const lastColumnIndex = columns.length - 1;

            if (command === SQLCommand.insert) {
              //
              // insert into users ${sql(users)} or insert into users ${sql(user)}
              //

              // Build column list while determining which columns have at least one defined value
              const { definedColumns, columnsSql } = buildDefinedColumnsAndQuery(
                columns,
                items,
                this.escapeIdentifier.bind(this),
              );

              const definedColumnCount = definedColumns.length;
              if (definedColumnCount === 0) {
                throw new SyntaxError("Insert needs to have at least one column with a defined value");
              }
              const lastDefinedColumnIndex = definedColumnCount - 1;

              query += columnsSql;
              if ($isArray(items)) {
                const itemsCount = items.length;
                const lastItemIndex = itemsCount - 1;
                for (let j = 0; j < itemsCount; j++) {
                  query += "(";
                  const item = items[j];
                  for (let k = 0; k < definedColumnCount; k++) {
                    const column = definedColumns[k];
                    const columnValue = item[column];
                    // SQLite uses ? for placeholders, not $1, $2, etc.
                    query += `?${k < lastDefinedColumnIndex ? ", " : ""}`;
                    // If this item has undefined for a column that other items defined, use null
                    binding_values.push(typeof columnValue === "undefined" ? null : columnValue);
                  }
                  if (j < lastItemIndex) {
                    query += "),";
                  } else {
                    query += ") "; // the user can add RETURNING * or RETURNING id
                  }
                }
              } else {
                query += "(";
                const item = items;
                for (let j = 0; j < definedColumnCount; j++) {
                  const column = definedColumns[j];
                  const columnValue = item[column];
                  // SQLite uses ? for placeholders
                  query += `?${j < lastDefinedColumnIndex ? ", " : ""}`;
                  binding_values.push(columnValue);
                }
                query += ") "; // the user can add RETURNING * or RETURNING id
              }
            } else if (command === SQLCommand.in) {
              // SELECT * FROM users WHERE id IN (${sql([1, 2, 3])})
              if (!$isArray(items)) {
                throw new SyntaxError("An array of values is required for WHERE IN helper");
              }
              const itemsCount = items.length;
              const lastItemIndex = itemsCount - 1;
              query += "(";
              for (let j = 0; j < itemsCount; j++) {
                // SQLite uses ? for placeholders
                query += `?${j < lastItemIndex ? ", " : ""}`;
                if (columnCount > 0) {
                  // we must use a key from a object
                  if (columnCount > 1) {
                    // we should not pass multiple columns here
                    throw new SyntaxError("Cannot use WHERE IN helper with multiple columns");
                  }
                  // SELECT * FROM users WHERE id IN (${sql(users, "id")})
                  const value = items[j];
                  if (typeof value === "undefined") {
                    binding_values.push(null);
                  } else {
                    const value_from_key = value[columns[0]];

                    if (typeof value_from_key === "undefined") {
                      binding_values.push(null);
                    } else {
                      binding_values.push(value_from_key);
                    }
                  }
                } else {
                  const value = items[j];
                  if (typeof value === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(value);
                  }
                }
              }
              query += ") "; // more conditions can be added after this
            } else {
              // UPDATE users SET ${sql({ name: "John", age: 31 })} WHERE id = 1
              let item;
              if ($isArray(items)) {
                if (items.length > 1) {
                  throw new SyntaxError("Cannot use array of objects for UPDATE");
                }
                item = items[0];
              } else {
                item = items;
              }
              // no need to include if is updateSet
              if (command === SQLCommand.update) {
                query += " SET ";
              }
              for (let i = 0; i < columnCount; i++) {
                const column = columns[i];
                const columnValue = item[column];
                if (typeof columnValue === "undefined") {
                  // skip undefined values, this is the expected behavior in JS
                  continue;
                }
                // SQLite uses ? for placeholders
                query += `${this.escapeIdentifier(column)} = ?${i < lastColumnIndex ? ", " : ""}`;
                if (typeof columnValue === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(columnValue);
                }
              }
              if (query.endsWith(", ")) {
                // we got an undefined value at the end, lets remove the last comma
                query = query.substring(0, query.length - 2);
              }
              if (query.endsWith("SET ")) {
                throw new SyntaxError("Update needs to have at least one column");
              }
              // the user can add where clause after this
              query += " ";
            }
          } else {
            // SQLite uses ? for placeholders
            query += `? `;
            if (typeof value === "undefined") {
              binding_values.push(null);
            } else {
              binding_values.push(value);
            }
          }
        }
      } else {
        throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
      }
    }

    return [query, binding_values];
  }

  connect(onConnected: OnConnected<BunSQLiteModule.Database>, reserved?: boolean) {
    if (this._closed) {
      return onConnected(this.connectionClosedError(), null);
    }

    // SQLite doesn't support reserved connections since it doesn't have a connection pool
    // Reserved connections are meant for exclusive use from a pool, which SQLite doesn't have
    if (reserved) {
      return onConnected(new Error("SQLite doesn't support connection reservation (no connection pool)"), null);
    }

    // Since SQLite connection is synchronous, we immediately know the result
    if (this.storedError) {
      onConnected(this.storedError, null);
    } else if (this.db) {
      onConnected(null, this.db);
    } else {
      onConnected(this.connectionClosedError(), null);
    }
  }

  release(_connection: BunSQLiteModule.Database, _connectingEvent?: boolean) {
    // SQLite doesn't need to release connections since we don't pool. We
    // shouldn't throw or prevent the user facing API from releasing connections
    // so we can just no-op here
  }

  async close(_options?: { timeout?: number }) {
    if (this._closed) {
      return;
    }

    this._closed = true;

    this.storedError = new Error("Connection closed");

    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }

    try {
      const onclose = this.connectionInfo.onclose;
      if (onclose) onclose(this.storedError);
    } catch {}
  }

  flush() {
    // SQLite executes queries synchronously, so there's nothing to flush
    throw new Error("SQLite doesn't support flush() - queries are executed synchronously");
  }

  isConnected() {
    return this.db !== null;
  }

  get closed(): boolean {
    return this._closed;
  }

  supportsReservedConnections(): boolean {
    // SQLite doesn't have a connection pool, so it doesn't support reserved connections
    return false;
  }

  getConnectionForQuery(connection: BunSQLiteModule.Database): BunSQLiteModule.Database {
    return connection;
  }
  array(_values: any[], _typeNameOrID?: number | ArrayType): SQLArrayParameter {
    throw new Error("SQLite doesn't support arrays");
  }
  getTransactionCommands(options?: string): import("./shared").TransactionCommands {
    let BEGIN = "BEGIN";

    if (options) {
      // SQLite supports DEFERRED, IMMEDIATE, EXCLUSIVE
      const upperOptions = options.toUpperCase();
      if (upperOptions === "DEFERRED" || upperOptions === "IMMEDIATE" || upperOptions === "EXCLUSIVE") {
        BEGIN = `BEGIN ${upperOptions}`;
      } else if (upperOptions === "READONLY" || upperOptions === "READ") {
        // SQLite doesn't support readonly transactions
        throw new Error(`SQLite doesn't support '${options}' transaction mode. Use DEFERRED, IMMEDIATE, or EXCLUSIVE.`);
      } else {
        BEGIN = `BEGIN ${options}`;
      }
    }

    return {
      BEGIN,
      COMMIT: "COMMIT",
      ROLLBACK: "ROLLBACK",
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
    };
  }

  getDistributedTransactionCommands(_name: string): import("./shared").TransactionCommands | null {
    // SQLite doesn't support distributed transactions
    return null;
  }

  validateTransactionOptions(options: string): { valid: boolean; error?: string } {
    if (!options) {
      return { valid: true };
    }

    const upperOptions = options.toUpperCase();
    if (upperOptions === "READONLY" || upperOptions === "READ") {
      return {
        valid: false,
        error: `SQLite doesn't support '${options}' transaction mode. Use DEFERRED, IMMEDIATE, or EXCLUSIVE.`,
      };
    }

    // SQLite will handle validation of other options
    return { valid: true };
  }

  validateDistributedTransactionName(): { valid: boolean; error?: string } {
    return {
      valid: false,
      error: "SQLite doesn't support distributed transactions.",
    };
  }

  getCommitDistributedSQL(): string {
    throw new Error("SQLite doesn't support distributed transactions.");
  }

  getRollbackDistributedSQL(): string {
    throw new Error("SQLite doesn't support distributed transactions.");
  }
}

export default {
  SQLiteAdapter,
  SQLCommand,
  commandToString,
  parseSQLQuery,
  SQLiteQueryHandle,
};
