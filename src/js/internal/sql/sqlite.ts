import type * as BunSQLiteModule from "bun:sqlite";
import type { BaseQueryHandle, Query } from "./query";
import type { DatabaseAdapter, OnConnected } from "./shared";

type SQLQueryResultMode = import("./query").SQLQueryResultMode;
type SQLResultArray<T> = import("./shared").SQLResultArray<T>;

const { SQLDialect, SQLResultArray, firstKeyword } = require("internal/sql/shared");
const { SQLQueryResultMode } = require("internal/sql/query");
const { closeTimeoutMs } = require("internal/sql/pool");
const { SQLiteError } = require("internal/sql/errors");

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

function lastInsertRowid(db: BunSQLiteModule.Database) {
  return db.query("SELECT last_insert_rowid()").values()[0][0] as number | bigint;
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
    const { sql, values, mode, adapter } = this;
    const command = firstKeyword(sql);
    let result: SQLResultArray<unknown>;
    try {
      let rows: unknown[] | undefined;
      let changes: BunSQLiteModule.Changes | undefined;
      let readonly = false;
      // The rows that the statements after the first one changed. `undefined` when there are none.
      let tailChanges: number | undefined;
      // Text without a statement is left to db.run(), which says so.
      if (command !== "") {
        // Compiles the first statement of the text and runs nothing.
        const stmt = db.prepare<unknown, any[]>(sql);
        try {
          const returnsRows = stmt.native.columnsCount > 0;
          // A Statement without parameters ignores its arguments. Of one that returns no rows, db.run() has always
          // said that an array of values has no place.
          if (returnsRows || stmt.paramsCount > 0 || !($isArray(values) && values.length > 0)) {
            if (returnsRows) {
              readonly = stmt.readonly;
              if (mode === SQLQueryResultMode.values) {
                rows = stmt.values(values);
              } else if (mode === SQLQueryResultMode.raw) {
                rows = stmt.raw(values);
              } else {
                const columnFrom = $getByIdDirect(adapter.connectionInfo, "transform")?.column.from;
                if (columnFrom !== undefined) stmt.native.$setColumnNameTransform(columnFrom);
                rows = stmt.all(values);
              }
            } else {
              changes = stmt.run(values);
            }
            // Not db.run(): it runs a statement that got no values with NULL in their place.
            tailChanges = stmt.native.$runTail(sql);
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
          result.lastInsertRowid = lastInsertRowid(db);
        }
      } else {
        changes ??= db.run<any>(sql, values);
        result = new SQLResultArray();
        result.count = result.affectedRows = changes.changes + (tailChanges ?? 0);
        result.lastInsertRowid = tailChanges === undefined ? changes.lastInsertRowid : lastInsertRowid(db);
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

class SQLiteAdapter
  extends SQLDialect
  implements DatabaseAdapter<BunSQLiteModule.Database, BunSQLiteModule.Database, SQLiteQueryHandle>
{
  public readonly connectionInfo: Bun.SQL.__internal.DefinedSQLiteOptions;
  public db: BunSQLiteModule.Database | null = null;
  public storedError: Error | null = null;
  public closed: boolean = false;
  /// There is one connection and plain queries always run on it, so reserve() has nothing to give.
  public readonly supportsReservedConnections = false;
  readonly emptyList = "()";
  readonly namedParameters = true;
  /// A begin() has the database, and the ones that came after it wait in order. Plain queries do not wait: they join.
  private inBegin: boolean = false;
  private waitingBegins: OnConnected<BunSQLiteModule.Database>[] = [];
  private closeHandlers: Set<(err: Error) => void> = new Set();

  constructor(connectionInfo: Bun.SQL.__internal.DefinedSQLiteOptions) {
    super();
    this.connectionInfo = connectionInfo;

    const { filename, readonly, create, safeIntegers, strict, onconnect } = {
      __proto__: null,
      ...connectionInfo,
    } as unknown as typeof connectionInfo;
    try {
      // not before an SQLite client is made
      const { Database } = require("../../bun/sqlite.ts") as typeof BunSQLiteModule;
      this.db = new Database(
        filename,
        // Read-only wins over `create` and `readwrite`. Else a file that is not there is made, unless `create` is false.
        (readonly
          ? { __proto__: null, readonly: true, safeIntegers, strict }
          : {
              __proto__: null,
              readwrite: true,
              create: create !== false,
              safeIntegers,
              strict,
            }) as unknown as BunSQLiteModule.DatabaseOptions,
      );
    } catch (err) {
      // A mistake in the options, not a database that cannot be opened: `new SQL()` throws it.
      if (err instanceof TypeError) throw err;
      this.storedError = toSQLiteError(err) as Error;
    }
    try {
      if (onconnect) onconnect(this.storedError);
    } catch (thrown) {
      reportError(thrown);
    }
  }

  createQueryHandle(sql: string, values: unknown[] | Record<string, unknown>): SQLiteQueryHandle {
    return new SQLiteQueryHandle(sql, values, this);
  }
  error(code: string, message: string) {
    return new SQLiteError(message, { code: "ERR_SQLITE_" + code, errno: 0 });
  }

  connect(onConnected: OnConnected<BunSQLiteModule.Database>, reserved?: boolean) {
    if (this.closed) {
      return onConnected(this.connectionClosedError(), null);
    }

    // Since SQLite connection is synchronous, we immediately know the result
    const storedError = this.storedError;
    const db = this.db!;
    if (storedError) {
      onConnected(storedError, null);
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
    if (this.closed) {
      return;
    }

    this.closed = true;

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
      const onclose = $getByIdDirect(this.connectionInfo, "onclose");
      if (onclose) onclose(this.storedError);
    } catch (thrown) {
      reportError(thrown);
    }
  }

  flush() {
    // Queries run synchronously, so nothing is ever buffered.
  }

  isConnected() {
    return this.db !== null;
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
  array(): never {
    throw new Error("SQLite doesn't support arrays");
  }
  getTransactionCommands(options?: string) {
    const upperOptions = options?.toUpperCase();
    if (upperOptions === "READONLY" || upperOptions === "READ") {
      throw new Error(`SQLite doesn't support '${options}' transaction mode. Use DEFERRED, IMMEDIATE, or EXCLUSIVE.`);
    }
    return super.getTransactionCommands(options);
  }

  getDistributedTransactionCommands() {
    return null;
  }
  getFinishDistributedSQL(): never {
    throw new Error("SQLite doesn't support distributed transactions.");
  }
}

export default {
  SQLiteAdapter,
};
