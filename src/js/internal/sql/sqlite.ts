import type * as BunSQLiteModule from "bun:sqlite";
import type { BaseQueryHandle, Query, SQLQueryResultMode } from "./query";
import type { DatabaseAdapter, OnConnected, SQLHelper, SQLResultArray } from "./shared";

const { SQLHelper, SQLResultArray } = require("internal/sql/shared");
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
  firstKeyword: string; // SELECT, INSERT, UPDATE, etc.
  hasReturning: boolean;
}

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.in:
    case SQLCommand.where:
      return "WHERE";
    default:
      return "";
  }
}

function matchAsciiIgnoreCase(str: string, start: number, end: number, target: string): boolean {
  if (end - start !== target.length) return false;
  for (let i = 0; i < target.length; i++) {
    const c = str.charCodeAt(start + i);
    const t = target.charCodeAt(i);

    if (c !== t) {
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

function parseSQLQuery(query: string): SQLParsedInfo {
  const text_len = query.length;

  // Skip leading whitespace/delimiters
  let i = 0;
  while (i < text_len && isTokenDelimiter(query.charCodeAt(i))) {
    i++;
  }

  let command = SQLCommand.none;
  let firstKeyword = "";
  let hasReturning = false;
  let quotedDouble = false;
  let tokenStart = i;

  while (i < text_len) {
    const char = query[i];
    const charCode = query.charCodeAt(i);

    // Handle quotes BEFORE checking delimiters, since quotes are also delimiters
    // Handle single quotes - skip entire string literal
    if (!quotedDouble && char === "'") {
      // Process any pending token before the quote
      if (i > tokenStart) {
        // We have a token to process before the quote
        // Check what token it is
        // Track the first keyword for the command string
        if (!firstKeyword) {
          if (matchAsciiIgnoreCase(query, tokenStart, i, "select")) {
            firstKeyword = "SELECT";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "insert")) {
            firstKeyword = "INSERT";
            command = SQLCommand.insert;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "update")) {
            firstKeyword = "UPDATE";
            command = SQLCommand.update;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "delete")) {
            firstKeyword = "DELETE";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "create")) {
            firstKeyword = "CREATE";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "drop")) {
            firstKeyword = "DROP";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "alter")) {
            firstKeyword = "ALTER";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "pragma")) {
            firstKeyword = "PRAGMA";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "explain")) {
            firstKeyword = "EXPLAIN";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "with")) {
            firstKeyword = "WITH";
          }
        } else {
          // After we have the first keyword, look for other keywords
          if (matchAsciiIgnoreCase(query, tokenStart, i, "where")) {
            command = SQLCommand.where;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "set")) {
            if (command === SQLCommand.update) {
              command = SQLCommand.updateSet;
            }
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "in")) {
            command = SQLCommand.in;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "returning")) {
            hasReturning = true;
          }
        }
      }

      // Now skip the entire string literal
      i++;
      while (i < text_len) {
        if (query[i] === "'") {
          // Check for escaped quote
          if (i + 1 < text_len && query[i + 1] === "'") {
            i += 2; // Skip escaped quote
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      // After string, skip any whitespace and reset token start
      while (i < text_len && isTokenDelimiter(query.charCodeAt(i))) {
        i++;
      }
      tokenStart = i;
      continue;
    }

    if (char === '"') {
      quotedDouble = !quotedDouble;
      i++;
      continue;
    }

    if (quotedDouble) {
      i++;
      continue;
    }

    if (isTokenDelimiter(charCode)) {
      if (i > tokenStart) {
        // Track the first keyword for the command string
        if (!firstKeyword) {
          if (matchAsciiIgnoreCase(query, tokenStart, i, "select")) {
            firstKeyword = "SELECT";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "insert")) {
            firstKeyword = "INSERT";
            command = SQLCommand.insert;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "update")) {
            firstKeyword = "UPDATE";
            command = SQLCommand.update;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "delete")) {
            firstKeyword = "DELETE";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "create")) {
            firstKeyword = "CREATE";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "drop")) {
            firstKeyword = "DROP";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "alter")) {
            firstKeyword = "ALTER";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "pragma")) {
            firstKeyword = "PRAGMA";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "explain")) {
            firstKeyword = "EXPLAIN";
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "with")) {
            firstKeyword = "WITH";
          }
        } else {
          // After we have the first keyword, look for other keywords
          if (matchAsciiIgnoreCase(query, tokenStart, i, "where")) {
            command = SQLCommand.where;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "set")) {
            if (command === SQLCommand.update) {
              command = SQLCommand.updateSet;
            }
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "in")) {
            command = SQLCommand.in;
          } else if (matchAsciiIgnoreCase(query, tokenStart, i, "returning")) {
            hasReturning = true;
          }
        }
      }

      // Skip delimiters but stop at quotes (they need special handling)
      while (++i < text_len) {
        const nextChar = query[i];
        if (nextChar === "'" || nextChar === '"') {
          break; // Stop at quotes, they'll be handled in next iteration
        }
        if (!isTokenDelimiter(query.charCodeAt(i))) {
          break; // Stop at non-delimiter
        }
      }
      tokenStart = i;
      continue;
    }
    i++;
  }

  // Handle last token if we reached end of string
  if (i >= text_len && i > tokenStart && !quotedDouble) {
    // Track the first keyword for the command string
    if (!firstKeyword) {
      if (matchAsciiIgnoreCase(query, tokenStart, i, "select")) {
        firstKeyword = "SELECT";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "insert")) {
        firstKeyword = "INSERT";
        command = SQLCommand.insert;
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "update")) {
        firstKeyword = "UPDATE";
        command = SQLCommand.update;
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "delete")) {
        firstKeyword = "DELETE";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "create")) {
        firstKeyword = "CREATE";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "drop")) {
        firstKeyword = "DROP";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "alter")) {
        firstKeyword = "ALTER";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "pragma")) {
        firstKeyword = "PRAGMA";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "explain")) {
        firstKeyword = "EXPLAIN";
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "with")) {
        firstKeyword = "WITH";
      }
    } else {
      // After we have the first keyword, look for other keywords
      if (matchAsciiIgnoreCase(query, tokenStart, i, "where")) {
        command = SQLCommand.where;
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "set")) {
        if (command === SQLCommand.update) {
          command = SQLCommand.updateSet;
        }
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "in")) {
        command = SQLCommand.in;
      } else if (matchAsciiIgnoreCase(query, tokenStart, i, "returning")) {
        hasReturning = true;
      }
    }
  }

  return { command, firstKeyword, hasReturning };
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
      const command = parsedInfo.firstKeyword;

      // For SELECT queries, we need to use a prepared statement
      // For other queries, we can check if there are multiple statements and use db.run() if so
      if (
        command === "SELECT" ||
        command === "PRAGMA" ||
        command === "WITH" ||
        command === "EXPLAIN" ||
        parsedInfo.hasReturning
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
    let cachedCommand: SQLCommand | null = null;

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
            if (cachedCommand === null) {
              const { command } = parseSQLQuery(query);
              cachedCommand = command;
            }
            const command = cachedCommand;

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

              query += "(";
              for (let j = 0; j < columnCount; j++) {
                query += this.escapeIdentifier(columns[j]);
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
                // SQLite uses ? for placeholders
                query += `${this.escapeIdentifier(column)} = ?${i < lastColumnIndex ? ", " : ""}`;
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
