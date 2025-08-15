import type * as BunSQLiteModule from "bun:sqlite";
import type { BaseQueryHandle, Query, SQLQueryResultMode } from "./query";
import type { DatabaseAdapter, OnConnected, SQLHelper, SQLResultArray } from "./shared";

const { SQLHelper, SQLResultArray } = require("internal/sql/shared");
const {
  Query,
  SQLQueryResultMode,
  SQLQueryFlags,
  symbols: { _strings, _values },
} = require("internal/sql/query");
const { escapeIdentifier, connectionClosedError } = require("internal/sql/utils");
const { SQLiteError } = require("internal/sql/errors");

let lazySQLiteModule: typeof BunSQLiteModule;
function getSQLiteModule() {
  if (!lazySQLiteModule) {
    lazySQLiteModule = require("../../bun/sqlite.ts");
  }
  return lazySQLiteModule;
}

enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  whereIn = 4,
  none = -1,
}

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.whereIn:
    case SQLCommand.where:
      return "WHERE";
    default:
      return "";
  }
}

// Case-insensitive string comparison without allocation
function matchesIgnoreCase(str: string, start: number, end: number, target: string): boolean {
  if (end - start !== target.length) return false;
  for (let i = 0; i < target.length; i++) {
    const c = str.charCodeAt(start + i);
    const t = target.charCodeAt(i);
    // Check if they match (considering case)
    if (c !== t) {
      // If not equal, check if they differ by case (A-Z is 65-90, a-z is 97-122)
      if (c >= 65 && c <= 90) {
        if (c + 32 !== t) return false;
      } else if (c >= 97 && c <= 122) {
        if (c - 32 !== t) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

// Check if character is whitespace or delimiter (anything that's not a letter/digit/underscore)
function isTokenDelimiter(code: number): boolean {
  // Quick check for common ASCII whitespace
  if (code <= 32) return true;
  // Letters A-Z, a-z
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return false;
  // Digits 0-9
  if (code >= 48 && code <= 57) return false;
  // Underscore (allowed in SQL identifiers)
  if (code === 95) return false;
  // Everything else is a delimiter (including Unicode whitespace, punctuation, etc.)
  return true;
}

function detectCommand(query: string): SQLCommand {
  const text_len = query.length;

  // Skip leading whitespace/delimiters
  let i = 0;
  while (i < text_len && isTokenDelimiter(query.charCodeAt(i))) {
    i++;
  }

  let command = SQLCommand.none;
  let quoted = false;
  let tokenStart = i;

  while (i < text_len) {
    const char = query[i];

    if (char === '"') {
      quoted = !quoted;
      i++;
      continue;
    }

    if (quoted) {
      i++;
      continue;
    }

    const charCode = query.charCodeAt(i);
    if (isTokenDelimiter(charCode)) {
      if (i > tokenStart) {
        if (matchesIgnoreCase(query, tokenStart, i, "insert")) {
          if (command === SQLCommand.none) {
            return SQLCommand.insert;
          }
          return command;
        } else if (matchesIgnoreCase(query, tokenStart, i, "update")) {
          if (command === SQLCommand.none) {
            command = SQLCommand.update;
            while (++i < text_len && isTokenDelimiter(query.charCodeAt(i))) {}
            tokenStart = i;
            continue;
          }
          return command;
        } else if (matchesIgnoreCase(query, tokenStart, i, "where")) {
          command = SQLCommand.where;
          while (++i < text_len && isTokenDelimiter(query.charCodeAt(i))) {}
          tokenStart = i;
          continue;
        } else if (matchesIgnoreCase(query, tokenStart, i, "set")) {
          if (command === SQLCommand.update) {
            command = SQLCommand.updateSet;
            while (++i < text_len && isTokenDelimiter(query.charCodeAt(i))) {}
            tokenStart = i;
            continue;
          }
          return command;
        } else if (matchesIgnoreCase(query, tokenStart, i, "in")) {
          if (command === SQLCommand.where) {
            return SQLCommand.whereIn;
          }
          return command;
        }
      }

      while (++i < text_len && isTokenDelimiter(query.charCodeAt(i))) {}
      tokenStart = i;
      continue;
    }
    i++;
  }

  // Handle last token if we reached end of string
  if (i >= text_len && i > tokenStart && !quoted) {
    switch (command) {
      case SQLCommand.none: {
        if (matchesIgnoreCase(query, tokenStart, i, "insert")) {
          return SQLCommand.insert;
        } else if (matchesIgnoreCase(query, tokenStart, i, "update")) {
          return SQLCommand.update;
        } else if (matchesIgnoreCase(query, tokenStart, i, "where")) {
          return SQLCommand.where;
        }
        return SQLCommand.none;
      }
      case SQLCommand.update: {
        if (matchesIgnoreCase(query, tokenStart, i, "set")) {
          return SQLCommand.updateSet;
        }
        return SQLCommand.update;
      }
      case SQLCommand.where: {
        if (matchesIgnoreCase(query, tokenStart, i, "in")) {
          return SQLCommand.whereIn;
        }
        return SQLCommand.where;
      }
    }
  }

  return command;
}

export class SQLiteQueryHandle implements BaseQueryHandle<BunSQLiteModule.Database> {
  private mode = SQLQueryResultMode.objects;

  private readonly sql: string;
  private readonly values: unknown[];

  public constructor(sql: string, values: unknown[]) {
    this.sql = sql;
    this.values = values;
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

    const { sql, values, mode } = this;

    try {
      const commandMatch = sql.trim().match(/^(\w+)/i);
      const command = commandMatch ? commandMatch[1].toUpperCase() : "";

      // For SELECT queries, we need to use a prepared statement
      // For other queries, we can check if there are multiple statements and use db.run() if so
      if (
        command === "SELECT" ||
        sql.trim().toUpperCase().includes("RETURNING") ||
        command === "PRAGMA" ||
        command === "WITH" ||
        command === "EXPLAIN"
      ) {
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

        sqlResult.command = command;
        sqlResult.count = $isArray(result) ? result.length : 1;

        stmt.finalize();
        query.resolve(sqlResult);
      } else {
        // For INSERT/UPDATE/DELETE/CREATE etc., use db.run() which handles multiple statements natively
        const changes = db.run.$apply(db, [sql].concat(values));
        const sqlResult = new SQLResultArray();

        sqlResult.command = command;
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

export class SQLiteAdapter
  implements DatabaseAdapter<BunSQLiteModule.Database, BunSQLiteModule.Database, SQLiteQueryHandle>
{
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
    }
  }

  createQueryHandle(sql: string, values: unknown[] | undefined | null = []): SQLiteQueryHandle {
    return new SQLiteQueryHandle(sql, values ?? []);
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
            const command = detectCommand(query);
            // only selectIn, insert, update, updateSet are allowed
            if (command === SQLCommand.none || command === SQLCommand.where) {
              throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and WHERE IN commands");
            }
            const { columns, value: items } = value as SQLHelper;
            const columnCount = columns.length;
            if (columnCount === 0 && command !== SQLCommand.whereIn) {
              throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
            }
            const lastColumnIndex = columns.length - 1;

            if (command === SQLCommand.insert) {
              //
              // insert into users ${sql(users)} or insert into users ${sql(user)}
              //

              query += "(";
              for (let j = 0; j < columnCount; j++) {
                query += escapeIdentifier(columns[j]);
                if (j < lastColumnIndex) {
                  query += ", ";
                }
              }
              query += ") VALUES";
              if ($isArray(items)) {
                const itemsCount = items.length;
                const lastItemIndex = itemsCount - 1;
                for (let j = 0; j < itemsCount; j++) {
                  query += "(";
                  const item = items[j];
                  for (let k = 0; k < columnCount; k++) {
                    const column = columns[k];
                    const columnValue = item[column];
                    // SQLite uses ? for placeholders, not $1, $2, etc.
                    query += `?${k < lastColumnIndex ? ", " : ""}`;
                    if (typeof columnValue === "undefined") {
                      binding_values.push(null);
                    } else {
                      binding_values.push(columnValue);
                    }
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
                for (let j = 0; j < columnCount; j++) {
                  const column = columns[j];
                  const columnValue = item[column];
                  // SQLite uses ? for placeholders
                  query += `?${j < lastColumnIndex ? ", " : ""}`;
                  if (typeof columnValue === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(columnValue);
                  }
                }
                query += ") "; // the user can add RETURNING * or RETURNING id
              }
            } else if (command === SQLCommand.whereIn) {
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
                // SQLite uses ? for placeholders
                query += `${escapeIdentifier(column)} = ?${i < lastColumnIndex ? ", " : ""}`;
                if (typeof columnValue === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(columnValue);
                }
              }
              query += " "; // the user can add where clause after this
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
      return onConnected(connectionClosedError(), null);
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
      onConnected(connectionClosedError(), null);
    }
  }

  release(connection: BunSQLiteModule.Database, connectingEvent?: boolean) {
    // SQLite doesn't need to release connections since we don't pool
    // No-op for SQLite
  }

  async close(options?: { timeout?: number }) {
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

  getDistributedTransactionCommands(name: string): import("./shared").TransactionCommands | null {
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

  validateDistributedTransactionName(name: string): { valid: boolean; error?: string } {
    return {
      valid: false,
      error: "SQLite doesn't support distributed transactions.",
    };
  }

  getCommitDistributedSQL(name: string): string {
    throw new Error("SQLite doesn't support distributed transactions.");
  }

  getRollbackDistributedSQL(name: string): string {
    throw new Error("SQLite doesn't support distributed transactions.");
  }
}

export default {
  SQLiteAdapter,
  SQLCommand,
  commandToString,
  detectCommand,
};
