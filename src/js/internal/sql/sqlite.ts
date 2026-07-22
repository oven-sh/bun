import type * as BunSQLiteModule from "bun:sqlite";
import type { BaseQueryHandle, Query, SQLQueryResultMode } from "./query";
import type {
  ArrayType,
  DatabaseAdapter,
  OnConnected,
  SQLCommand as SharedSQLCommand,
  SQLArrayParameter,
  SQLResultArray,
} from "./shared";

const { SQLResultArray, normalizeQuery, pushBindParam } = require("internal/sql/shared");
const { SQLQueryResultMode } = require("internal/sql/query");
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
          case "EXPLAIN": {
            lastToken = token;

            // Only top-level SELECT-like statements should return rows
            if (command === SQLCommand.none) {
              canReturnRows = true;
            }

            token = "";
            continue;
          }

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
      case "EXPLAIN": {
        if (command === SQLCommand.none) {
          canReturnRows = true;
        }
        break;
      }

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

      const connectionInfo = this.connectionInfo;
      if ("safeIntegers" in connectionInfo) {
        options.safeIntegers = connectionInfo.safeIntegers;
      }
      if ("strict" in connectionInfo) {
        options.strict = connectionInfo.strict;
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
    return normalizeQuery(this, strings, values, binding_idx);
  }

  // SQLite uses ? for placeholders, not $1, $2, etc.
  placeholder(_index: number): string {
    return "?";
  }

  bindParam(value: unknown, binding_values: unknown[], index: number): string {
    return pushBindParam(this, value, binding_values, index);
  }

  getHelperCommand(query: string): SharedSQLCommand {
    // when partial is true we stop on the first command we find
    const { command } = parseSQLQuery(query, true);

    // only selectIn, insert, update, updateSet are allowed
    if (command === SQLCommand.none || command === SQLCommand.where) {
      throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and WHERE IN commands");
    }
    // the local SQLCommand enum is numerically identical to the shared one
    return command as unknown as SharedSQLCommand;
  }

  isUpsertUpdate(_query: string): boolean {
    return false;
  }

  throwIfUpdateEmpty(_query: string, hasValues: boolean): void {
    if (!hasValues) {
      throw new SyntaxError("Update needs to have at least one column");
    }
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
    const storedError = this.storedError;
    let db;
    if (storedError) {
      onConnected(storedError, null);
    } else if ((db = this.db)) {
      onConnected(null, db);
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

    // The string is interpolated into `BEGIN ${options}`, so refuse anything that
    // could terminate the statement or start a new one.
    if (!/^[A-Za-z ,]*$/.test(options)) {
      return {
        valid: false,
        error: "Transaction options can only contain letters, spaces, and commas.",
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
