import type * as BunSQLiteModule from "bun:sqlite";
import type { BaseQueryHandle, Query, QueryStrings } from "./query";
import type { ArrayType, DatabaseAdapter, OnConnected, SQLArrayParameter } from "./shared";

type SQLQueryResultMode = import("./query").SQLQueryResultMode;
type SQLResultArray<T> = import("./shared").SQLResultArray<T>;

const { SQLResultArray, normalizeQuery, firstKeyword } = require("internal/sql/shared");
const { SQLQueryResultMode } = require("internal/sql/query");
const { closeTimeoutMs } = require("internal/sql/pool");
const { SQLiteError } = require("internal/sql/errors");

let lazySQLiteModule: typeof BunSQLiteModule;
function getSQLiteModule() {
  if (!lazySQLiteModule) {
    lazySQLiteModule = require("../../bun/sqlite.ts");
  }
  return lazySQLiteModule;
}

function toSQLiteError(err: unknown) {
  if (err && typeof err === "object" && "name" in err && err.name === "SQLiteError") {
    const code = "code" in err ? String(err.code) : "SQLITE_ERROR";
    const errno = "errno" in err ? Number(err.errno) : 1;
    const byteOffset = "byteOffset" in err ? Number(err.byteOffset) : undefined;
    const message = "message" in err ? String(err.message) : "SQLite error";

    return new SQLiteError(message, { code, errno, byteOffset });
  }
  return err;
}

// SQLite's own white space: it reports U+00A0 and the like as a syntax error.
const blank = /^[; \t\n\v\f\r]*$/;
/// `false` also for a ";" in a literal or a comment: db.run() finds out what follows it.
function isOneStatement(sql: string): boolean {
  const end = sql.indexOf(";");
  return end === -1 || blank.test(sql.slice(end + 1));
}

class SQLiteQueryHandle implements BaseQueryHandle<BunSQLiteModule.Database> {
  private mode = SQLQueryResultMode.objects;

  private readonly sql: string;
  private readonly values: unknown[] | Record<string, unknown>;
  private readonly adapter: SQLiteAdapter;

  public constructor(sql: string, values: unknown[] | Record<string, unknown>, adapter: SQLiteAdapter) {
    this.sql = sql;
    this.values = values;
    this.adapter = adapter;
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

    const { sql, values, mode, adapter } = this;
    const command = firstKeyword(sql);
    let result: SQLResultArray<unknown>;
    try {
      let rows: unknown[] | undefined;
      let changes: BunSQLiteModule.Changes | undefined;
      let readonly = false;
      // Text without a statement is left to db.run(), which says so.
      if (command !== "") {
        // Compiles the first statement of the text and runs nothing.
        const stmt = db.prepare<unknown, any[]>(sql);
        try {
          if (stmt.native.columnsCount > 0) {
            readonly = stmt.readonly;
            if (mode === SQLQueryResultMode.values) {
              rows = stmt.values(values);
            } else if (mode === SQLQueryResultMode.raw) {
              rows = stmt.raw(values);
            } else {
              const columnFrom = adapter.connectionInfo.transform?.column.from;
              if (columnFrom !== undefined) stmt.native.$setColumnNameTransform(columnFrom);
              rows = stmt.all(values);
            }
          } else if (isOneStatement(sql) && (stmt.paramsCount > 0 || (values as unknown[]).length === 0)) {
            changes = stmt.run(values);
          }
        } finally {
          stmt.finalize();
        }
      }

      if (rows !== undefined) {
        result = new SQLResultArray(rows);
        result.count = rows.length;
        if (readonly) {
          result.affectedRows = 0;
        } else {
          result.affectedRows = rows.length;
          result.lastInsertRowid = db.query("SELECT last_insert_rowid()").values()[0][0] as number | bigint;
        }
      } else {
        // There may be more than one statement, or bindings that the statement has no place for.
        changes ??= db.run<any>(sql, values);
        result = new SQLResultArray();
        result.count = result.affectedRows = changes.changes;
        result.lastInsertRowid = changes.lastInsertRowid;
      }
    } catch (err) {
      throw toSQLiteError(err);
    } finally {
      // bun:sqlite refuses a close() that `column.from` makes: the statement is on a row
      if (adapter.closed) db.close();
    }
    result.command = command;
    query.resolve(result);
  }
}

class SQLiteAdapter implements DatabaseAdapter<BunSQLiteModule.Database, BunSQLiteModule.Database, SQLiteQueryHandle> {
  public readonly connectionInfo: Bun.SQL.__internal.DefinedSQLiteOptions;
  public db: BunSQLiteModule.Database | null = null;
  public storedError: Error | null = null;
  private _closed: boolean = false;
  /// A begin() has the database, and the ones that came after it wait in order. Plain queries do not wait: they join.
  private inBegin: boolean = false;
  private waitingBegins: OnConnected<BunSQLiteModule.Database>[] = [];
  private closeHandlers: Set<(err: Error) => void> = new Set();

  constructor(connectionInfo: Bun.SQL.__internal.DefinedSQLiteOptions) {
    this.connectionInfo = connectionInfo;

    try {
      const SQLiteModule = getSQLiteModule();
      const { filename, readonly, create, readwrite, safeIntegers, strict } = connectionInfo;

      this.db = new SQLiteModule.Database(filename, { readonly, create, readwrite, safeIntegers, strict });

      try {
        const onconnect = this.connectionInfo.onconnect;
        if (onconnect) onconnect(null);
      } catch {}
    } catch (err) {
      // A mistake in the options, not a database that cannot be opened: `new SQL()` throws it.
      if (err instanceof TypeError) throw err;
      this.storedError = toSQLiteError(err) as Error;
      this.db = null;
      try {
        const onconnect = this.connectionInfo.onconnect;
        if (onconnect) onconnect(this.storedError);
      } catch {}
    }
  }

  createQueryHandle(sql: string, values: unknown[] | Record<string, unknown>): SQLiteQueryHandle {
    return new SQLiteQueryHandle(sql, values, this);
  }
  escapeIdentifier(str: string) {
    if (str.includes("\0")) {
      throw $ERR_INVALID_ARG_VALUE("name", str, "must not contain null bytes");
    }
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
  normalizeQuery(strings: QueryStrings, values: unknown[]): [string, unknown[]] {
    return normalizeQuery(this, strings, values);
  }

  // SQLite uses ? for placeholders, not $1, $2, etc.
  placeholder(_index: number): string {
    return "?";
  }

  connect(onConnected: OnConnected<BunSQLiteModule.Database>, reserved?: boolean) {
    if (this._closed) {
      return onConnected(this.connectionClosedError(), null);
    }

    // Since SQLite connection is synchronous, we immediately know the result
    const storedError = this.storedError;
    const db = this.db;
    if (storedError) {
      onConnected(storedError, null);
    } else if (!db) {
      onConnected(this.connectionClosedError(), null);
    } else if (!reserved) {
      onConnected(null, db);
    } else if (this.inBegin) {
      this.waitingBegins.push(onConnected);
    } else {
      this.inBegin = true;
      onConnected(null, db);
    }
  }

  cancelConnect(onConnected: OnConnected<BunSQLiteModule.Database>): boolean {
    const index = this.waitingBegins.indexOf(onConnected);
    if (index === -1) {
      return false;
    }
    this.waitingBegins.splice(index, 1);
    return true;
  }

  /// Pairs with a connect(onConnected, true) that got the database.
  release(connection: BunSQLiteModule.Database) {
    const next = this.waitingBegins.shift();
    if (next) {
      next(null, connection);
    } else {
      this.inBegin = false;
    }
  }

  async close(options?: { timeout?: number }) {
    closeTimeoutMs(options);
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

    const waitingBegins = this.waitingBegins;
    const closeHandlers = this.closeHandlers;
    this.waitingBegins = [];
    this.closeHandlers = new Set();
    for (let i = 0; i < waitingBegins.length; i++) {
      waitingBegins[i](this.connectionClosedError(), null);
    }
    for (const onClose of closeHandlers) {
      onClose(this.connectionClosedError());
    }

    try {
      const onclose = this.connectionInfo.onclose;
      if (onclose) onclose(this.storedError);
    } catch {}
  }

  flush() {
    // Queries run synchronously, so nothing is ever buffered.
  }

  isConnected() {
    return this.db !== null;
  }

  get closed(): boolean {
    return this._closed;
  }

  supportsReservedConnections(): boolean {
    // There is one connection and plain queries always run on it, so reserve() has nothing to give.
    return false;
  }

  getConnectionForQuery(connection: BunSQLiteModule.Database): BunSQLiteModule.Database {
    if (connection !== this.db) {
      throw this.connectionClosedError();
    }
    return connection;
  }

  attachConnectionCloseHandler(_connection: BunSQLiteModule.Database, handler: (err: Error) => void): void {
    this.closeHandlers.add(handler);
  }

  detachConnectionCloseHandler(_connection: BunSQLiteModule.Database, handler: (err: Error) => void): void {
    this.closeHandlers.delete(handler);
  }

  isInTransaction(connection: BunSQLiteModule.Database): boolean {
    return connection === this.db && connection.inTransaction;
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

  getCommitDistributedSQL(): string {
    throw new Error("SQLite doesn't support distributed transactions.");
  }

  getRollbackDistributedSQL(): string {
    throw new Error("SQLite doesn't support distributed transactions.");
  }
}

export default {
  SQLiteAdapter,
};
