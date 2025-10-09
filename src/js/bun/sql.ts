import type { MySQLAdapter } from "internal/sql/mysql";
import type { PostgresAdapter } from "internal/sql/postgres";
import type { BaseQueryHandle, Query } from "internal/sql/query";
import type { SQLHelper } from "internal/sql/shared";

const { Query, SQLQueryFlags } = require("internal/sql/query");
const { PostgresAdapter } = require("internal/sql/postgres");
const { MySQLAdapter } = require("internal/sql/mysql");
const { SQLiteAdapter } = require("internal/sql/sqlite");
const { SQLHelper, parseOptions } = require("internal/sql/shared");

const { SQLError, PostgresError, SQLiteError, MySQLError } = require("internal/sql/errors");

const defineProperties = Object.defineProperties;

// Typed Copy options and binary type tokens
type CopyBinaryBaseType =
  | "bool"
  | "int2"
  | "int4"
  | "int8"
  | "float4"
  | "float8"
  | "text"
  | "varchar"
  | "bpchar"
  | "bytea"
  | "date"
  | "time"
  | "timestamp"
  | "timestamptz"
  | "uuid"
  | "json"
  | "jsonb"
  | "numeric"
  | "interval";

type CopyBinaryArrayType = `${CopyBinaryBaseType}[]`;
type CopyBinaryType = CopyBinaryBaseType | CopyBinaryArrayType;

interface CopyFromOptionsBase {
  format?: "text" | "csv" | "binary";
  delimiter?: string;
  null?: string;
  sanitizeNUL?: boolean;
  replaceInvalid?: string;
  signal?: AbortSignal;
  onProgress?: (info: { bytesSent: number; chunksSent: number }) => void;
  batchSize?: number;
  /**
   * Maximum number of bytes to send per chunk. Defaults to 256 KiB when not set.
   */
  maxChunkSize?: number;
  /**
   * Maximum total number of bytes to send for this COPY FROM operation.
   * When exceeded, the operation is aborted with CopyFail.
   */
  maxBytes?: number;
  /**
   * COPY operation timeout in milliseconds (0 = no timeout).
   */
  timeout?: number;
}

interface CopyFromBinaryOptions extends CopyFromOptionsBase {
  format: "binary";
  binaryTypes: CopyBinaryType[];
}

type CopyFromOptions = CopyFromOptionsBase | CopyFromBinaryOptions;

interface CopyToOptions {
  table: string;
  columns?: string[];
  format?: "text" | "csv" | "binary";
  signal?: AbortSignal;
  onProgress?: (info: { bytesReceived: number; chunksReceived: number }) => void;
  /**
   * Maximum total number of bytes to receive for this COPY TO operation.
   * When exceeded, the stream stops early with an error.
   */
  maxBytes?: number;
  /**
   * Enable streaming mode to avoid buffering in Zig. Defaults to true.
   */
  stream?: boolean;
  /**
   * COPY operation timeout in milliseconds (0 = no timeout).
   */
  timeout?: number;
}

type SQLTemplateFn = (strings: TemplateStringsArray | string, ...values: unknown[]) => Query<unknown, unknown>;
type TransactionCallback = (sql: SQLTemplateFn) => Promise<unknown>;

enum ReservedConnectionState {
  acceptQueries = 1 << 0,
  closed = 1 << 1,
}

interface TransactionState {
  connectionState: ReservedConnectionState;
  reject: (err: Error) => void;
  storedError?: Error | null | undefined;
  queries: Set<Query<any, any>>;
}

function adapterFromOptions(options: Bun.SQL.__internal.DefinedOptions) {
  switch (options.adapter) {
    case "postgres":
      return new PostgresAdapter(options);
    case "mysql":
    case "mariadb":
      return new MySQLAdapter(options);
    case "sqlite":
      return new SQLiteAdapter(options);
    default:
      throw new Error(`Unsupported adapter: ${(options as { adapter?: string }).adapter}.`);
  }
}

const SQL: typeof Bun.SQL = function SQL(
  stringOrUrlOrOptions: Bun.SQL.Options | string | undefined = undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options = {},
): Bun.SQL {
  const connectionInfo = parseOptions(stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty);
  const pool = adapterFromOptions(connectionInfo);

  function onQueryDisconnected(this: Query<any, any>, err: Error) {
    // connection closed mid query this will not be called if the query finishes first
    const query = this;

    if (err) {
      return query.reject(err);
    }

    // query is cancelled when waiting for a connection from the pool
    if (query.cancelled) {
      return query.reject(pool.queryCancelledError());
    }
  }

  function onQueryConnected(
    this: Query<any, any>,
    handle: BaseQueryHandle<any>,
    err,
    connectionHandle: ConnectionHandle,
  ) {
    const query = this;
    if (err) {
      // fail to aquire a connection from the pool
      return query.reject(err);
    }
    // query is cancelled when waiting for a connection from the pool
    if (query.cancelled) {
      pool.release(connectionHandle); // release the connection back to the pool
      return query.reject(pool.queryCancelledError());
    }

    if (connectionHandle.bindQuery) {
      connectionHandle.bindQuery(query, onQueryDisconnected.bind(query));
    }

    try {
      const connection = pool.getConnectionForQuery ? pool.getConnectionForQuery(connectionHandle) : connectionHandle;
      const result = handle.run(connection, query);

      if (result && $isPromise(result)) {
        result.catch(err => query.reject(err));
      }
    } catch (err) {
      query.reject(err);
    }
  }
  function queryFromPoolHandler(query, handle, err) {
    if (err) {
      // fail to create query
      return query.reject(err);
    }

    // query is cancelled
    if (!handle || query.cancelled) {
      return query.reject(pool.queryCancelledError());
    }

    pool.connect(onQueryConnected.bind(query, handle));
  }

  function queryFromPool(
    strings:
      | string
      | TemplateStringsArray
      | import("internal/sql/shared.ts").SQLHelper<unknown>
      | Query<unknown, unknown>,
    values: unknown[],
  ) {
    try {
      return new Query(
        strings,
        values,
        connectionInfo.bigint ? SQLQueryFlags.bigint : SQLQueryFlags.none,
        queryFromPoolHandler,
        pool,
      );
    } catch (err) {
      return Promise.$reject(err);
    }
  }

  function unsafeQuery(
    strings:
      | string
      | TemplateStringsArray
      | import("internal/sql/shared.ts").SQLHelper<unknown>
      | Query<unknown, unknown>,
    values: unknown[],
  ) {
    try {
      let flags = connectionInfo.bigint ? SQLQueryFlags.bigint | SQLQueryFlags.unsafe : SQLQueryFlags.unsafe;
      if ((values?.length ?? 0) === 0) {
        flags |= SQLQueryFlags.simple;
      }
      return new Query(strings, values, flags, queryFromPoolHandler, pool);
    } catch (err) {
      return Promise.$reject(err);
    }
  }

  function onTransactionQueryDisconnected(query: Query<any, any>) {
    const transactionQueries = this;
    transactionQueries.delete(query);
  }

  function queryFromTransactionHandler(transactionQueries, query, handle, err) {
    const pooledConnection = this;
    if (err) {
      transactionQueries.delete(query);
      return query.reject(err);
    }

    // query is cancelled
    if (query.cancelled) {
      transactionQueries.delete(query);
      return query.reject(pool.queryCancelledError());
    }

    query.finally(onTransactionQueryDisconnected.bind(transactionQueries, query));

    try {
      // Use adapter method to get the actual connection
      const connection = pool.getConnectionForQuery ? pool.getConnectionForQuery(pooledConnection) : pooledConnection;
      const result = handle.run(connection, query);
      if (result && $isPromise(result)) {
        result.catch(err => query.reject(err));
      }
    } catch (err) {
      query.reject(err);
    }
  }

  function queryFromTransaction(
    strings:
      | string
      | TemplateStringsArray
      | import("internal/sql/shared.ts").SQLHelper<unknown>
      | Query<unknown, unknown>,
    values: unknown[],
    pooledConnection: PooledPostgresConnection,
    transactionQueries: Set<Query<any, any>>,
  ) {
    try {
      const query = new Query(
        strings,
        values,
        connectionInfo.bigint
          ? SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.bigint
          : SQLQueryFlags.allowUnsafeTransaction,
        queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
        pool,
      );

      transactionQueries.add(query);
      return query;
    } catch (err) {
      return Promise.$reject(err);
    }
  }

  function unsafeQueryFromTransaction(
    strings:
      | string
      | TemplateStringsArray
      | import("internal/sql/shared.ts").SQLHelper<unknown>
      | Query<unknown, unknown>,
    values: unknown[],
    pooledConnection: PooledPostgresConnection,
    transactionQueries: Set<Query<any, any>>,
  ) {
    try {
      let flags = connectionInfo.bigint
        ? SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.unsafe | SQLQueryFlags.bigint
        : SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.unsafe;

      if ((values?.length ?? 0) === 0) {
        flags |= SQLQueryFlags.simple;
      }
      const query = new Query(
        strings,
        values,
        flags,
        queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
        pool,
      );
      transactionQueries.add(query);
      return query;
    } catch (err) {
      return Promise.$reject(err);
    }
  }

  function onTransactionDisconnected(this: TransactionState, err: Error) {
    const reject = this.reject;
    this.connectionState |= ReservedConnectionState.closed;

    for (const query of this.queries) {
      query.reject(err);
    }

    if (err) {
      return reject(err);
    }
  }

  function onReserveConnected(this: Query<unknown, unknown>, err: Error | null, pooledConnection) {
    const { resolve, reject } = this;

    if (err) {
      return reject(err);
    }

    let reservedTransaction = new Set();

    const state: TransactionState = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      storedError: null,
      queries: new Set(),
    };

    const clampUint32 = (value: number) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(0xffffffff, Math.trunc(n));
    };

    const onClose = onTransactionDisconnected.bind(state);
    if (pooledConnection.onClose) {
      pooledConnection.onClose(onClose);
    }

    function reserved_sql(
      strings: string | TemplateStringsArray | SQLHelper<unknown> | Query<unknown, unknown>,
      ...values: unknown[]
    ) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.$reject(pool.connectionClosedError());
      }
      if ($isArray(strings)) {
        // detect if is tagged template
        if (!$isArray(strings.raw)) {
          return new SQLHelper(strings, values);
        }
      } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
        return new SQLHelper([strings], values);
      }
      // we use the same code path as the transaction sql
      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }

    reserved_sql.unsafe = (string, args = []) => {
      return unsafeQueryFromTransaction(string, args, pooledConnection, state.queries);
    };

    reserved_sql.file = async (path: string, args = []) => {
      return await Bun.file(path)
        .text()
        .then(text => {
          return unsafeQueryFromTransaction(text, args, pooledConnection, state.queries);
        });
    };

    reserved_sql.connect = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.$reject(pool.connectionClosedError());
      }
      return Promise.$resolve(reserved_sql);
    };

    reserved_sql.commitDistributed = async function (name: string) {
      if (!pool.getCommitDistributedSQL) {
        throw Error(`This adapter doesn't support distributed transactions.`);
      }

      const sql = pool.getCommitDistributedSQL(name);
      return await reserved_sql.unsafe(sql);
    };
    reserved_sql.rollbackDistributed = async function (name: string) {
      if (!pool.getRollbackDistributedSQL) {
        throw Error(`This adapter doesn't support distributed transactions.`);
      }

      const sql = pool.getRollbackDistributedSQL(name);
      return await reserved_sql.unsafe(sql);
    };

    // reserve is allowed to be called inside reserved connection but will return a new reserved connection from the pool
    // this matchs the behavior of the postgres package
    reserved_sql.reserve = () => sql.reserve();
    reserved_sql.array = sql.array;

    // COPY FROM STDIN low-level helpers (Phase 2)
    // These delegate to adapter instance methods bound to this reserved connection
    reserved_sql.onCopyStart = (handler: () => void) => {
      // register one-shot callback when server replies with CopyInResponse/CopyOutResponse
      pool.onCopyStartFor(pooledConnection, handler);
    };
    reserved_sql.copySendData = (data: string | Uint8Array) => {
      pool.copySendDataFor(pooledConnection, data);
    };
    reserved_sql.copyDone = () => {
      pool.copyDoneFor(pooledConnection);
    };
    reserved_sql.copyFail = (message?: string) => {
      pool.copyFailFor(pooledConnection, message);
    };
    /**
     * Enable or disable streaming mode for COPY TO.
     * When enabled, the connection will not accumulate COPY TO data in memory
     * and will emit chunks via onCopyChunk instead.
     */
    /** @type {(enable: boolean) => void} */
    reserved_sql.setCopyStreamingMode = (enable: boolean) => {
      if (typeof (pool as any).setCopyStreamingModeFor === "function") {
        (pool as any).setCopyStreamingModeFor(pooledConnection, !!enable);
      } else {
        const underlying = pool.getConnectionForQuery
          ? pool.getConnectionForQuery(pooledConnection)
          : pooledConnection?.connection;
        if (underlying && (PostgresAdapter as any).setCopyStreamingMode) {
          (PostgresAdapter as any).setCopyStreamingMode(underlying, !!enable);
        }
      }
    };
    /** @type {(ms: number) => void} */
    reserved_sql.setCopyTimeout = (ms: number) => {
      if (typeof (pool as any).setCopyTimeoutFor === "function") {
        (pool as any).setCopyTimeoutFor(pooledConnection, clampUint32(ms));
      } else {
        const underlying = pool.getConnectionForQuery
          ? pool.getConnectionForQuery(pooledConnection)
          : pooledConnection?.connection;
        if (underlying && (PostgresAdapter as any).setCopyTimeout) {
          (PostgresAdapter as any).setCopyTimeout(underlying, clampUint32(ms));
        }
      }
    };
    /** @type {(bytes: number) => void} */
    reserved_sql.setMaxCopyBufferSize = (bytes: number) => {
      if (typeof (pool as any).setMaxCopyBufferSizeFor === "function") {
        (pool as any).setMaxCopyBufferSizeFor(pooledConnection, clampUint32(bytes));
      } else {
        const underlying = pool.getConnectionForQuery
          ? pool.getConnectionForQuery(pooledConnection)
          : pooledConnection?.connection;
        if (underlying && (PostgresAdapter as any).setMaxCopyBufferSize) {
          (PostgresAdapter as any).setMaxCopyBufferSize(underlying, clampUint32(bytes));
        }
      }
    };
    // Expose adapter-level COPY defaults on reserved connections
    reserved_sql.getCopyDefaults = () => {
      return pool.getCopyDefaults();
    };
    reserved_sql.setCopyDefaults = (defaults: {
      from?: { maxChunkSize?: number; maxBytes?: number; timeout?: number };
      to?: { stream?: boolean; maxBytes?: number; timeout?: number };
    }) => {
      pool.setCopyDefaultsFor(pooledConnection, defaults);
    };

    // Streaming COPY TO STDOUT helpers (Phase 4)
    reserved_sql.onCopyChunk = (handler: (chunk: string | ArrayBuffer | Uint8Array) => void) => {
      const underlying = pool.getConnectionForQuery
        ? pool.getConnectionForQuery(pooledConnection)
        : pooledConnection?.connection;
      if (underlying && (PostgresAdapter as any).onCopyChunk) {
        (PostgresAdapter as any).onCopyChunk(underlying, handler);
      }
    };
    reserved_sql.onCopyEnd = (handler: () => void) => {
      const underlying = pool.getConnectionForQuery
        ? pool.getConnectionForQuery(pooledConnection)
        : pooledConnection?.connection;
      if (underlying && (PostgresAdapter as any).onCopyEnd) {
        (PostgresAdapter as any).onCopyEnd(underlying, handler);
      }
    };

    function onTransactionFinished(transaction_promise: Promise<any>) {
      reservedTransaction.delete(transaction_promise);
    }
    reserved_sql.beginDistributed = (name: string, fn: TransactionCallback) => {
      // begin is allowed the difference is that we need to make sure to use the same connection and never release it
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.$reject(pool.connectionClosedError());
      }
      let callback = fn;

      if (typeof name !== "string") {
        return Promise.$reject($ERR_INVALID_ARG_VALUE("name", name, "must be a string"));
      }

      if (!$isCallable(callback)) {
        return Promise.$reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      // lets just reuse the same code path as the transaction begin
      onTransactionConnected(callback, name, resolve, reject, true, true, null, pooledConnection);
      reservedTransaction.add(promise);
      promise.finally(onTransactionFinished.bind(null, promise));
      return promise;
    };
    reserved_sql.begin = (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
      // begin is allowed the difference is that we need to make sure to use the same connection and never release it
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.$reject(pool.connectionClosedError());
      }
      let callback = fn;
      let options: string | undefined = options_or_fn as unknown as string;
      if ($isCallable(options_or_fn)) {
        callback = options_or_fn as unknown as TransactionCallback;
        options = undefined;
      } else if (typeof options_or_fn !== "string") {
        return Promise.$reject($ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string"));
      }
      if (!$isCallable(callback)) {
        return Promise.$reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      // lets just reuse the same code path as the transaction begin
      onTransactionConnected(callback, options, resolve, reject, true, false, null, pooledConnection);
      reservedTransaction.add(promise);
      promise.finally(onTransactionFinished.bind(null, promise));
      return promise;
    };

    reserved_sql.flush = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        throw pool.connectionClosedError();
      }
      // Use pooled connection's flush if available, otherwise use adapter's flush
      if (pooledConnection.flush) {
        return pooledConnection.flush();
      }
      return pool.flush();
    };
    reserved_sql.close = async (options?: { timeout?: number }) => {
      const reserveQueries = state.queries;
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.$resolve(undefined);
      }
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      let timeout = options?.timeout;
      if (timeout) {
        timeout = Number(timeout);
        if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
          throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
        }
        if (timeout > 0 && (reserveQueries.size > 0 || reservedTransaction.size > 0)) {
          const { promise, resolve } = Promise.withResolvers();
          // race all queries vs timeout
          const pending_queries = Array.from(reserveQueries);
          const pending_transactions = Array.from(reservedTransaction);
          const timer = setTimeout(() => {
            state.connectionState |= ReservedConnectionState.closed;
            for (const query of reserveQueries) {
              (query as Query<any, any>).cancel();
            }
            state.connectionState |= ReservedConnectionState.closed;
            pooledConnection.close();

            resolve();
          }, timeout * 1000);
          timer.unref(); // dont block the event loop
          Promise.all([Promise.all(pending_queries), Promise.all(pending_transactions)]).finally(() => {
            clearTimeout(timer);
            resolve();
          });
          return promise;
        }
      }
      state.connectionState |= ReservedConnectionState.closed;
      for (const query of reserveQueries) {
        (query as Query<any, any>).cancel();
      }

      pooledConnection.close();

      return Promise.$resolve(undefined);
    };
    reserved_sql.release = () => {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.$reject(pool.connectionClosedError());
      }
      // just release the connection back to the pool
      state.connectionState |= ReservedConnectionState.closed;
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      // Use adapter method to detach connection close handler
      if (pool.detachConnectionCloseHandler) {
        pool.detachConnectionCloseHandler(pooledConnection, onClose);
      }
      pool.release(pooledConnection);
      return Promise.$resolve(undefined);
    };
    // this dont need to be async dispose only disposable but we keep compatibility with other types of sql functions
    reserved_sql[Symbol.asyncDispose] = () => reserved_sql.release();
    reserved_sql[Symbol.dispose] = () => reserved_sql.release();

    reserved_sql.options = sql.options;
    reserved_sql.transaction = reserved_sql.begin;
    reserved_sql.distributed = reserved_sql.beginDistributed;
    reserved_sql.end = reserved_sql.close;
    resolve(reserved_sql);
  }
  async function onTransactionConnected(
    callback,
    options,
    resolve,
    reject,
    dontRelease,
    distributed,
    err,
    pooledConnection,
  ) {
    /*
    BEGIN; -- works on POSTGRES, MySQL (autocommit is true, no options accepted), and SQLite (no options accepted) (need to change to BEGIN TRANSACTION on MSSQL)
    START TRANSACTION; -- works on POSTGRES, MySQL (autocommit is false, options accepted), (need to change to BEGIN TRANSACTION on MSSQL and BEGIN on SQLite)

    -- Create a SAVEPOINT
    SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (need to change to SAVE TRANSACTION on MSSQL)

    -- QUERY

    -- Roll back to SAVEPOINT if needed
    ROLLBACK TO SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (need to change to ROLLBACK TRANSACTION on MSSQL)

    -- Release the SAVEPOINT
    RELEASE SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (MSSQL dont have RELEASE SAVEPOINT you just need to transaction again)

    -- Commit the transaction
    COMMIT; -- works on POSTGRES, MySQL, and SQLite (need to change to COMMIT TRANSACTION on MSSQL)
    -- or rollback everything
    ROLLBACK; -- works on POSTGRES, MySQL, and SQLite (need to change to ROLLBACK TRANSACTION on MSSQL)

    */

    if (err) {
      return reject(err);
    }

    const state: TransactionState = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      queries: new Set(),
    };

    let savepoints = 0;
    let transactionSavepoints = new Set();

    let BEGIN_COMMAND: string;
    let ROLLBACK_COMMAND: string;
    let COMMIT_COMMAND: string;
    let SAVEPOINT_COMMAND: string;
    let RELEASE_SAVEPOINT_COMMAND: string | null;
    let ROLLBACK_TO_SAVEPOINT_COMMAND: string;
    let BEFORE_COMMIT_OR_ROLLBACK_COMMAND: string | null = null;

    if (distributed) {
      // Get distributed transaction commands from adapter
      const commands = pool.getDistributedTransactionCommands?.(options);
      if (!commands) {
        pool.release(pooledConnection);
        return reject(new Error(`This adapter doesn't support distributed transactions.`));
      }

      BEGIN_COMMAND = commands.BEGIN;
      COMMIT_COMMAND = commands.COMMIT;
      ROLLBACK_COMMAND = commands.ROLLBACK;
      SAVEPOINT_COMMAND = commands.SAVEPOINT;
      RELEASE_SAVEPOINT_COMMAND = commands.RELEASE_SAVEPOINT;
      ROLLBACK_TO_SAVEPOINT_COMMAND = commands.ROLLBACK_TO_SAVEPOINT;
      BEFORE_COMMIT_OR_ROLLBACK_COMMAND = commands.BEFORE_COMMIT_OR_ROLLBACK || null;
    } else {
      // Validate transaction options if provided
      if (options && pool.validateTransactionOptions) {
        const validation = pool.validateTransactionOptions(options);
        if (!validation.valid) {
          pool.release(pooledConnection);
          return reject(new Error(validation.error));
        }
      }

      try {
        const commands = pool.getTransactionCommands(options);
        BEGIN_COMMAND = commands.BEGIN;
        COMMIT_COMMAND = commands.COMMIT;
        ROLLBACK_COMMAND = commands.ROLLBACK;
        SAVEPOINT_COMMAND = commands.SAVEPOINT;
        RELEASE_SAVEPOINT_COMMAND = commands.RELEASE_SAVEPOINT;
        ROLLBACK_TO_SAVEPOINT_COMMAND = commands.ROLLBACK_TO_SAVEPOINT;
        BEFORE_COMMIT_OR_ROLLBACK_COMMAND = commands.BEFORE_COMMIT_OR_ROLLBACK || null;
      } catch (err) {
        pool.release(pooledConnection);
        return reject(err);
      }
    }

    const onClose = onTransactionDisconnected.bind(state);
    // Use adapter method to attach connection close handler
    if (pool.attachConnectionCloseHandler) {
      pool.attachConnectionCloseHandler(pooledConnection, onClose);
    }

    function run_internal_transaction_sql(string) {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.$reject(pool.connectionClosedError());
      }
      return unsafeQueryFromTransaction(string, [], pooledConnection, state.queries);
    }
    function transaction_sql(
      strings:
        | string
        | TemplateStringsArray
        | import("internal/sql/shared.ts").SQLHelper<unknown>
        | Query<unknown, unknown>,
      ...values: unknown[]
    ) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.$reject(pool.connectionClosedError());
      }
      if ($isArray(strings)) {
        // detect if is tagged template
        if (!$isArray((strings as unknown as TemplateStringsArray).raw)) {
          return new SQLHelper(strings, values);
        }
      } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
        return new SQLHelper([strings], values);
      }

      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }
    transaction_sql.unsafe = (string, args = []) => {
      return unsafeQueryFromTransaction(string, args, pooledConnection, state.queries);
    };
    transaction_sql.file = async (path: string, args = []) => {
      return await Bun.file(path)
        .text()
        .then(text => {
          return unsafeQueryFromTransaction(text, args, pooledConnection, state.queries);
        });
    };
    // reserve is allowed to be called inside transaction connection but will return a new reserved connection from the pool and will not be part of the transaction
    // this matchs the behavior of the postgres package
    transaction_sql.reserve = () => sql.reserve();
    transaction_sql.array = sql.array;

    transaction_sql.connect = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.$reject(pool.connectionClosedError());
      }

      return Promise.$resolve(transaction_sql);
    };
    transaction_sql.commitDistributed = async function (name: string) {
      if (!pool.getCommitDistributedSQL) {
        throw Error(`This adapter doesn't support distributed transactions.`);
      }

      const sql = pool.getCommitDistributedSQL(name);
      return await run_internal_transaction_sql(sql);
    };
    transaction_sql.rollbackDistributed = async function (name: string) {
      if (!pool.getRollbackDistributedSQL) {
        throw Error(`This adapter doesn't support distributed transactions.`);
      }

      const sql = pool.getRollbackDistributedSQL(name);
      return await run_internal_transaction_sql(sql);
    };
    // begin is not allowed on a transaction we need to use savepoint() instead
    transaction_sql.begin = function () {
      if (distributed) {
        throw pool.invalidTransactionStateError("cannot call begin inside a distributed transaction");
      }
      throw pool.invalidTransactionStateError("cannot call begin inside a transaction use savepoint() instead");
    };

    transaction_sql.beginDistributed = function () {
      if (distributed) {
        throw pool.invalidTransactionStateError("cannot call beginDistributed inside a distributed transaction");
      }
      throw pool.invalidTransactionStateError(
        "cannot call beginDistributed inside a transaction use savepoint() instead",
      );
    };

    transaction_sql.flush = function () {
      if (state.connectionState & ReservedConnectionState.closed) {
        throw pool.connectionClosedError();
      }
      // Use pooled connection's flush if available, otherwise use adapter's flush
      if (pooledConnection.flush) {
        return pooledConnection.flush();
      }
      return pool.flush();
    };
    transaction_sql.close = async function (options?: { timeout?: number }) {
      // we dont actually close the connection here, we just set the state to closed and rollback the transaction
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.$resolve(undefined);
      }
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      const transactionQueries = state.queries;
      let timeout = options?.timeout;
      if (timeout) {
        timeout = Number(timeout);
        if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
          throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
        }

        if (timeout > 0 && (transactionQueries.size > 0 || transactionSavepoints.size > 0)) {
          const { promise, resolve } = Promise.withResolvers();
          // race all queries vs timeout
          const pending_queries = Array.from(transactionQueries);
          const pending_savepoints = Array.from(transactionSavepoints);
          const timer = setTimeout(async () => {
            for (const query of transactionQueries) {
              (query as Query<any, any>).cancel();
            }
            if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
              await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
            }
            await run_internal_transaction_sql(ROLLBACK_COMMAND);
            state.connectionState |= ReservedConnectionState.closed;
            resolve();
          }, timeout * 1000);
          timer.unref(); // dont block the event loop
          Promise.all([Promise.all(pending_queries), Promise.all(pending_savepoints)]).finally(() => {
            clearTimeout(timer);
            resolve();
          });
          return promise;
        }
      }
      for (const query of transactionQueries) {
        (query as Query<any, any>).cancel();
      }
      if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
        await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
      }
      await run_internal_transaction_sql(ROLLBACK_COMMAND);
      state.connectionState |= ReservedConnectionState.closed;
    };
    transaction_sql[Symbol.asyncDispose] = () => transaction_sql.close();
    transaction_sql.options = sql.options;

    transaction_sql.transaction = transaction_sql.begin;
    transaction_sql.distributed = transaction_sql.beginDistributed;
    transaction_sql.end = transaction_sql.close;
    function onSavepointFinished(savepoint_promise: Promise<any>) {
      transactionSavepoints.delete(savepoint_promise);
    }
    async function run_internal_savepoint(save_point_name: string, savepoint_callback: TransactionCallback) {
      await run_internal_transaction_sql(`${SAVEPOINT_COMMAND} ${save_point_name}`);

      try {
        let result = await savepoint_callback(transaction_sql);
        if (RELEASE_SAVEPOINT_COMMAND) {
          // mssql dont have release savepoint
          await run_internal_transaction_sql(`${RELEASE_SAVEPOINT_COMMAND} ${save_point_name}`);
        }
        if ($isArray(result)) {
          result = await Promise.all(result);
        }
        return result;
      } catch (err) {
        if (!(state.connectionState & ReservedConnectionState.closed)) {
          await run_internal_transaction_sql(`${ROLLBACK_TO_SAVEPOINT_COMMAND} ${save_point_name}`);
        }
        throw err;
      }
    }
    if (distributed) {
      transaction_sql.savepoint = async (_fn: TransactionCallback, _name?: string): Promise<any> => {
        throw pool.invalidTransactionStateError("cannot call savepoint inside a distributed transaction");
      };
    } else {
      transaction_sql.savepoint = async (fn: TransactionCallback, name?: string): Promise<any> => {
        let savepoint_callback = fn;

        if (
          state.connectionState & ReservedConnectionState.closed ||
          !(state.connectionState & ReservedConnectionState.acceptQueries)
        ) {
          throw pool.connectionClosedError();
        }

        if ($isCallable(name)) {
          savepoint_callback = name as unknown as TransactionCallback;
          name = "";
        }
        if (!$isCallable(savepoint_callback)) {
          throw $ERR_INVALID_ARG_VALUE("fn", callback, "must be a function");
        }
        // matchs the format of the savepoint name in postgres package
        const save_point_name = `s${savepoints++}${name ? `_${name}` : ""}`;
        const promise = run_internal_savepoint(save_point_name, savepoint_callback);
        transactionSavepoints.add(promise);
        return await promise.finally(onSavepointFinished.bind(null, promise));
      };
    }
    let needs_rollback = false;
    try {
      await run_internal_transaction_sql(BEGIN_COMMAND);
      needs_rollback = true;
      let transaction_result = await callback(transaction_sql);
      if ($isArray(transaction_result)) {
        transaction_result = await Promise.all(transaction_result);
      }
      // at this point we dont need to rollback anymore
      needs_rollback = false;
      if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
        await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
      }
      await run_internal_transaction_sql(COMMIT_COMMAND);
      return resolve(transaction_result);
    } catch (err) {
      try {
        if (!(state.connectionState & ReservedConnectionState.closed) && needs_rollback) {
          if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
            await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
          }
          await run_internal_transaction_sql(ROLLBACK_COMMAND);
        }
      } catch (err) {
        return reject(err);
      }
      return reject(err);
    } finally {
      state.connectionState |= ReservedConnectionState.closed;
      // Use adapter method to detach connection close handler
      if (pool.detachConnectionCloseHandler) {
        pool.detachConnectionCloseHandler(pooledConnection, onClose);
      }
      if (!dontRelease) {
        pool.release(pooledConnection);
      }
    }
  }
  function sql(
    strings: string | TemplateStringsArray | import("internal/sql/shared.ts").SQLHelper<any> | Query<any, any>,
    ...values: any[]
  ) {
    if ($isArray(strings)) {
      // detect if is tagged template
      if (!$isArray((strings as unknown as TemplateStringsArray).raw)) {
        return new SQLHelper(strings, values);
      }
    } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
      return new SQLHelper([strings], values);
    }

    return queryFromPool(strings, values);
  }

  sql.unsafe = (string, args = []) => {
    return unsafeQuery(string, args);
  };
  sql.file = async (path: string, args = []) => {
    return await Bun.file(path)
      .text()
      .then(text => {
        return unsafeQuery(text, args);
      });
  };

  sql.reserve = () => {
    if (pool.closed) {
      return Promise.$reject(pool.connectionClosedError());
    }

    // Check if adapter supports reserved connections
    if (pool.supportsReservedConnections && !pool.supportsReservedConnections()) {
      return Promise.$reject(new Error("This adapter doesn't support connection reservation"));
    }

    // Try to reserve a connection - adapters that support it will handle appropriately
    const promiseWithResolvers = Promise.withResolvers();
    pool.connect(onReserveConnected.bind(promiseWithResolvers), true);
    return promiseWithResolvers.promise;
  };

  sql.array = (values: any[], typeNameOrID: number | string | undefined = undefined) => {
    return pool.array(values, typeNameOrID);
  };

  // High-level COPY FROM STDIN helper
  // Usage: await sql.copyFrom("table", ["col1","col2"], data, {
  //   format: "text"|"csv"|"binary",
  //   delimiter?: string,
  //   null?: string,
  //   sanitizeNUL?: boolean,        // strip NUL (0x00) from strings and raw bytes
  //   replaceInvalid?: string,      // replacement for NUL in strings (default: "")
  //   signal?: AbortSignal,         // optional cancellation
  //   onProgress?: (info: { bytesSent: number; chunksSent: number }) => void, // optional progress
  // })
  // - data can be: string, any[][], generator/iterator, AsyncIterable<row[]>, or AsyncIterable<string|Uint8Array>
  sql.copyFrom = async function (
    table: string,
    columns: string[],
    data:
      | string
      | unknown[]
      | Iterable<unknown[]>
      | AsyncIterable<unknown[]>
      | AsyncIterable<string | Uint8Array | ArrayBuffer>
      | (() => Iterable<unknown[]>),
    options?: CopyFromOptions,
  ) {
    // Reserve a dedicated connection for COPY
    const reserved = await sql.reserve();
    const closeReserved = async () => {
      try {
        if (reserved && typeof (reserved as any).close === "function") {
          await (reserved as any).close();
        }
      } catch {}
    };

    // Helpers
    const escapeIdentifier =
      (pool as any).escapeIdentifier && typeof (pool as any).escapeIdentifier === "function"
        ? (s: string) => (pool as any).escapeIdentifier(s)
        : (s: string) => '"' + String(s).replaceAll('"', '""').replaceAll(".", '"."') + '"';

    const fmt = options?.format === "csv" ? "csv" : options?.format === "binary" ? "binary" : "text";
    const delimiter = options?.delimiter ?? (fmt === "csv" ? "," : "\t");
    const nullToken = options?.null ?? (fmt === "csv" ? "" : "\\N");

    const stripNul = options?.sanitizeNUL === true;
    const replaceInvalid = options?.replaceInvalid ?? "";

    const sanitizeString = (s: string) => (stripNul ? s.replace(/\u0000/g, replaceInvalid) : s);
    const sanitizeBytes = (u8: Uint8Array) => {
      if (!stripNul) return u8;
      let keep = 0;
      for (let i = 0; i < u8.length; i++) if (u8[i] !== 0) keep++;
      if (keep === u8.length) return u8;
      const out = new Uint8Array(keep);
      let j = 0;
      for (let i = 0; i < u8.length; i++) if (u8[i] !== 0) out[j++] = u8[i];
      return out;
    };

    // Abort handling and progress
    const signal: AbortSignal | undefined = options?.signal;
    let aborted = false;
    let bytesSent = 0;
    let chunksSent = 0;
    const notifyProgress = () => {
      try {
        options?.onProgress?.({ bytesSent, chunksSent });
      } catch {}
    };
    const onAbort = () => {
      aborted = true;
    };
    if (signal) {
      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const serializeValue = (v: any): string => {
      if (v === null || v === undefined) return nullToken;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === "boolean") return fmt === "csv" ? (v ? "true" : "false") : v ? "t" : "f";
      if (typeof v === "number" || typeof v === "bigint") return String(v);
      if (typeof v === "string") return sanitizeString(v);
      if (ArrayBuffer.isView(v) && !(globalThis as any).Buffer?.isBuffer?.(v)) {
        // Typed array -> string
        return String(v);
      }
      // Fallback stringify
      try {
        return sanitizeString(JSON.stringify(v));
      } catch {
        return sanitizeString(String(v));
      }
    };

    const needsCsvQuoting = (s: string) =>
      s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
    const csvQuote = (s: string) => `"${s.replaceAll('"', '""')}"`;

    // COPY text format escaping per PostgreSQL:
    // - Backslash is escape: \\ -> \\\\
    // - Tab -> \\t, LF -> \\n, CR -> \\r
    // Nulls use the caller-provided nullToken (default \\N) and should not be escaped here.
    const copyTextEscape = (s: string) => {
      // order matters: backslash first
      return s.replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
    };

    const serializeRow = (row: any[]): string => {
      if (fmt === "csv") {
        const parts = row.map(v => {
          // Check for actual null/undefined before serializing
          if (v === null || v === undefined) {
            return ""; // Emit unquoted empty field for NULL
          }
          const s = serializeValue(v);
          // Empty string should be quoted to distinguish from NULL
          if (s === "") {
            return csvQuote("");
          }
          return needsCsvQuoting(s) ? csvQuote(s) : s;
        });
        return parts.join(delimiter) + "\n";
      } else {
        // text format: escape backslash, tab, LF, CR; null => \N
        const parts = row.map(v => {
          const s = serializeValue(v);
          if (s === nullToken) return s;
          return copyTextEscape(s);
        });
        return parts.join(delimiter) + "\n";
      }
    };

    // Hoisted OID maps for both encoder and validator
    const TYPE_OID: Record<string, number> = {
      bool: 16,
      int2: 21,
      int4: 23,
      int8: 20,
      float4: 700,
      float8: 701,
      text: 25,
      varchar: 1043,
      bpchar: 1042,
      bytea: 17,
      date: 1082,
      time: 1083,
      timestamp: 1114,
      timestamptz: 1184,
      uuid: 2950,
      json: 114,
      jsonb: 3802,
      numeric: 1700,
      interval: 1186,
    };
    const TYPE_ARRAY_OID: Record<string, number> = {
      "bool[]": 1000,
      "int2[]": 1005,
      "int4[]": 1007,
      "int8[]": 1016,
      "float4[]": 1021,
      "float8[]": 1022,
      "text[]": 1009,
      "varchar[]": 1015,
      "bpchar[]": 1014,
      "bytea[]": 1001,
      "date[]": 1182,
      "time[]": 1183,
      "timestamp[]": 1115,
      "timestamptz[]": 1185,
      "uuid[]": 2951,
      "json[]": 199,
      "jsonb[]": 3807,
      "numeric[]": 1231,
    };

    const feedData = async () => {
      // Batch size for accumulating small chunks (configurable, default 64KB)
      const BATCH_SIZE =
        options && typeof (options as any).batchSize === "number" && (options as any).batchSize > 0
          ? ((options as any).batchSize as number)
          : 64 * 1024;
      let batch = "";

      // Binary COPY row encoder support (when options.binaryTypes is provided)
      // Minimal encoder for common base types; extend as needed.
      let binaryHeaderSent = false;
      const sendBinaryHeader = () => {
        if (binaryHeaderSent) return;
        const sig = new Uint8Array([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
        const flags = new Uint8Array(4); // 0
        const extlen = new Uint8Array(4); // 0
        (reserved as any).copySendData(new Uint8Array([...sig, ...flags, ...extlen]));
        binaryHeaderSent = true;
      };
      const sendBinaryTrailer = () => {
        if (!binaryHeaderSent) return;
        // int16 -1 (0xFFFF) big-endian
        (reserved as any).copySendData(new Uint8Array([0xff, 0xff]));
      };

      const be16 = (n: number) => {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setInt16(0, n, false);
        return b;
      };
      const be32 = (n: number) => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, n, false);
        return b;
      };
      const encText = new TextEncoder();

      // Encode one row into COPY BINARY tuple: int16 fieldCount; for each field: int32 length; value bytes
      // Supported binaryTypes:
      //   "bool","int2","int4","int8","float4","float8","text","bytea","date","time","timestamp","timestamptz","uuid","json","jsonb","numeric","interval","varchar","bpchar"
      //   arrays of the above: "<type>[]", e.g. "int4[]","text[]","uuid[]","varchar[]","bpchar[]"
      // OIDs and Array OIDs are hoisted above for use by both encoder and OID validator

      const encodeIntervalBinary = (val: any): Uint8Array => {
        let months = 0,
          days = 0;
        let micros = 0n;
        if (val && typeof val === "object") {
          if ("months" in val) months = Number((val as any).months) | 0;
          if ("days" in val) days = Number((val as any).days) | 0;
          if ("micros" in val) micros = BigInt((val as any).micros);
          else if ("ms" in val) micros = BigInt(Math.trunc((val as any).ms)) * 1000n;
          else if ("seconds" in val) micros = BigInt(Math.trunc((val as any).seconds)) * 1_000_000n;
        } else if (typeof val === "string") {
          const m = val.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
          if (m) {
            const hh = Number(m[1]) | 0,
              mm = Number(m[2]) | 0,
              ss = Number(m[3]) | 0;
            const frac = (m[4] || "").padEnd(6, "0").slice(0, 6);
            const us = Number(frac) | 0;
            micros = BigInt((hh * 3600 + mm * 60 + ss) * 1_000_000 + us);
          } else {
            micros = 0n;
          }
        } else if (typeof val === "number") {
          micros = BigInt(Math.trunc(val)) * 1000n; // assume ms
        }
        const out = new Uint8Array(16);
        const dv = new DataView(out.buffer);
        dv.setInt32(0, Number((micros >> 32n) & 0xffffffffn), false);
        dv.setUint32(4, Number(micros & 0xffffffffn), false);
        dv.setInt32(8, days, false);
        dv.setInt32(12, months, false);
        return out;
      };

      const expandExponent = (s: string): string => {
        const m = s.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
        if (!m) return s;
        const sign = m[1] === "-" ? "-" : "";
        let intPart = m[2] || "0";
        let fracPart = m[3] || "";
        const exp = Number(m[4]) | 0;
        if (exp > 0) {
          const needed = exp - fracPart.length;
          if (needed >= 0) {
            intPart = intPart + fracPart + "0".repeat(needed);
            fracPart = "";
          } else {
            intPart = intPart + fracPart.slice(0, exp);
            fracPart = fracPart.slice(exp);
          }
        } else if (exp < 0) {
          const zeros = "0".repeat(-exp - intPart.length);
          const all = zeros ? zeros + intPart : intPart;
          const idx = all.length + exp; // exp negative
          fracPart = all.slice(idx) + fracPart;
          intPart = all.slice(0, idx) || "0";
        }
        intPart = intPart.replace(/^0+/, "") || "0";
        return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
      };

      const encodeNumericBinary = (val: any): Uint8Array => {
        let s = typeof val === "bigint" ? val.toString() : typeof val === "number" ? val.toString() : String(val);
        s = s.trim();
        if (!/^-?(\d+)(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
          throw new Error("numeric: value must be a plain decimal string/number");
        }
        if (/[eE]/.test(s)) s = expandExponent(s);
        let sign = 0x0000;
        if (s.startsWith("-")) {
          sign = 0x4000;
          s = s.slice(1);
        } else if (s.startsWith("+")) {
          s = s.slice(1);
        }
        let intPart = s;
        let fracPart = "";
        const dot = s.indexOf(".");
        if (dot !== -1) {
          intPart = s.slice(0, dot);
          fracPart = s.slice(dot + 1);
        }
        intPart = intPart.replace(/^0+/, "") || "0";
        const padLeft = (4 - (intPart.length % 4)) % 4;
        const intPadded = "0".repeat(padLeft) + intPart;
        const intGroups: number[] = [];
        for (let i = 0; i < intPadded.length; i += 4) {
          intGroups.push(parseInt(intPadded.slice(i, i + 4), 10) || 0);
        }
        const dscale = fracPart.length;
        const padRight = (4 - (fracPart.length % 4)) % 4;
        const fracPadded = fracPart + "0".repeat(padRight);
        const fracGroups: number[] = [];
        for (let i = 0; i < fracPadded.length; i += 4) {
          if (i < fracPart.length || padRight > 0) {
            const g = fracPadded.slice(i, i + 4);
            fracGroups.push(parseInt(g, 10) || 0);
          }
        }
        while (intGroups.length > 0 && intGroups[0] === 0) intGroups.shift();
        let weight = intGroups.length - 1;
        let digits = intGroups.concat(fracGroups);
        while (digits.length > 0 && digits[digits.length - 1] === 0) digits.pop();
        if (digits.length === 0) {
          const out = new Uint8Array(8);
          const dv = new DataView(out.buffer);
          dv.setInt16(0, 0, false);
          dv.setInt16(2, 0, false);
          dv.setInt16(4, 0x0000, false);
          dv.setInt16(6, dscale | 0, false);
          return out;
        }
        const ndigits = digits.length;
        const out = new Uint8Array(8 + ndigits * 2);
        const dv = new DataView(out.buffer);
        dv.setInt16(0, ndigits, false);
        dv.setInt16(2, weight, false);
        dv.setInt16(4, sign, false);
        dv.setInt16(6, dscale | 0, false);
        let o = 8;
        for (let i = 0; i < ndigits; i++) {
          dv.setInt16(o, digits[i], false);
          o += 2;
        }
        return out;
      };

      const encodeArray1D = (arr: unknown[], elemType: CopyBinaryBaseType): Uint8Array => {
        const oid = TYPE_OID[elemType];
        if (!oid) throw new Error(`Unsupported array base type for binary encoding: ${elemType}`);
        const n = arr.length;
        let hasNull = 0;
        const elems: Uint8Array[] = new Array(n);
        for (let i = 0; i < n; i++) {
          const v = arr[i];
          if (v === null || v === undefined) {
            elems[i] = new Uint8Array(0);
            hasNull = 1;
          } else {
            elems[i] = encodeBinaryValue(v, elemType);
          }
        }
        let size = 4 * 3 + 8; // ndim, hasnull, oid, dim length + lbound
        for (let i = 0; i < n; i++) {
          size += 4 + (elems[i].length || 0);
        }
        const out = new Uint8Array(size);
        const dv = new DataView(out.buffer);
        let o = 0;
        dv.setInt32(o, 1, false);
        o += 4;
        dv.setInt32(o, hasNull, false);
        o += 4;
        dv.setInt32(o, oid, false);
        o += 4;
        dv.setInt32(o, n, false);
        o += 4;
        dv.setInt32(o, 1, false);
        o += 4;
        for (let i = 0; i < n; i++) {
          if (arr[i] === null || arr[i] === undefined) {
            dv.setInt32(o, -1, false);
            o += 4;
          } else {
            const b = elems[i];
            dv.setInt32(o, b.length, false);
            o += 4;
            out.set(b, o);
            o += b.length;
          }
        }
        return out;
      };

      const encodeBinaryValue = (v: unknown, t: CopyBinaryType): Uint8Array => {
        // Handle arrays like "int4[]"
        if (t.endsWith("[]")) {
          const base = t.slice(0, -2);
          if (!Array.isArray(v)) throw new Error("binary array expects a JavaScript array value");
          return encodeArray1D(v, base);
        }
        switch (t) {
          case "bool": {
            const out = new Uint8Array(1);
            out[0] = v ? 1 : 0;
            return out;
          }
          case "int2": {
            const b = new Uint8Array(2);
            new DataView(b.buffer).setInt16(0, Number(v) | 0, false);
            return b;
          }
          case "int4": {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setInt32(0, Number(v) | 0, false);
            return b;
          }
          case "int8": {
            const b = new Uint8Array(8);
            const dv = new DataView(b.buffer);
            const big = BigInt(v);
            dv.setInt32(0, Number((big >> 32n) & 0xffffffffn), false);
            dv.setUint32(4, Number(big & 0xffffffffn), false);
            return b;
          }
          case "float4": {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setFloat32(0, Number(v), false);
            return b;
          }
          case "float8": {
            const b = new Uint8Array(8);
            new DataView(b.buffer).setFloat64(0, Number(v), false);
            return b;
          }
          case "bytea": {
            if (v instanceof Uint8Array) return v;
            if (v && v.byteLength !== undefined) return new Uint8Array(v as ArrayBuffer);
            const s = typeof v === "string" ? v : v == null ? "" : String(v);
            return encText.encode(s);
          }
          case "date": {
            // int32 days since 2000-01-01
            const epoch2000 = Date.UTC(2000, 0, 1);
            let ms: number;
            if (v instanceof Date) ms = v.getTime();
            else if (typeof v === "number") ms = v;
            else ms = new Date(v).getTime();
            const days = Math.floor((ms - epoch2000) / 86400000);
            const b = new Uint8Array(4);
            new DataView(b.buffer).setInt32(0, days, false);
            return b;
          }
          case "time": {
            // int64 microseconds since midnight
            const toMicros = (val: any): bigint => {
              if (typeof val === "number") return BigInt(Math.floor(val)); // assume already micros
              if (val instanceof Date) {
                const h = val.getUTCHours();
                const m = val.getUTCMinutes();
                const s = val.getUTCSeconds();
                const ms = val.getUTCMilliseconds();
                return BigInt(((h * 3600 + m * 60 + s) * 1000 + ms) * 1000);
              }
              const str = String(val);
              // HH:MM:SS(.frac)
              const m = str.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
              if (!m) return 0n;
              const hh = Number(m[1]) | 0;
              const mm = Number(m[2]) | 0;
              const ss = Number(m[3]) | 0;
              const frac = (m[4] || "").padEnd(6, "0").slice(0, 6);
              const us = Number(frac) | 0;
              return BigInt((hh * 3600 + mm * 60 + ss) * 1_000_000 + us);
            };
            const micros = toMicros(v);
            const b = new Uint8Array(8);
            const dv = new DataView(b.buffer);
            dv.setInt32(0, Number((micros >> 32n) & 0xffffffffn), false);
            dv.setUint32(4, Number(micros & 0xffffffffn), false);
            return b;
          }
          case "timestamp":
          case "timestamptz": {
            // int64 microseconds since 2000-01-01 UTC
            const epoch2000 = Date.UTC(2000, 0, 1);
            let ms: number;
            if (v instanceof Date) ms = v.getTime();
            else if (typeof v === "number") ms = v;
            else ms = new Date(v).getTime();
            const micros = BigInt(Math.round((ms - epoch2000) * 1000));
            const b = new Uint8Array(8);
            const dv = new DataView(b.buffer);
            dv.setInt32(0, Number((micros >> 32n) & 0xffffffffn), false);
            dv.setUint32(4, Number(micros & 0xffffffffn), false);
            return b;
          }
          case "uuid": {
            // 16 bytes
            const s = String(v).toLowerCase();
            const hex = s.replace(/-/g, "");
            const out = new Uint8Array(16);
            for (let i = 0; i < 16; i++) {
              const byte = hex.slice(i * 2, i * 2 + 2);
              out[i] = parseInt(byte, 16) || 0;
            }
            return out;
          }
          case "json": {
            const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
            return encText.encode(s);
          }
          case "jsonb": {
            const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
            const txt = encText.encode(s);
            // version 1 + textual json
            const out = new Uint8Array(1 + txt.length);
            out[0] = 1;
            out.set(txt, 1);
            return out;
          }
          case "numeric": {
            return encodeNumericBinary(v);
          }
          case "interval": {
            return encodeIntervalBinary(v);
          }
          case "varchar":
          case "bpchar":
          case "text":
          default: {
            // default to text encoding for unknown types
            const s = typeof v === "string" ? v : v == null ? "" : String(v);
            return encText.encode(s);
          }
        }
      };

      const encodeBinaryRow = (row: any[], types: string[]): Uint8Array => {
        const fieldCount = types.length;
        // First pass: compute total size
        let size = 2; // int16 field count
        const vals: Uint8Array[] = new Array(fieldCount);
        for (let i = 0; i < fieldCount; i++) {
          const val = row[i];
          if (val === null || val === undefined) {
            size += 4; // -1 length
            vals[i] = new Uint8Array(0); // placeholder
            continue;
          }
          const t = types[i];
          const bytes = encodeBinaryValue(val, t);
          vals[i] = bytes;
          size += 4 + bytes.length;
        }
        const out = new Uint8Array(size);
        const dv = new DataView(out.buffer);
        let o = 0;
        dv.setInt16(o, fieldCount, false);
        o += 2;
        for (let i = 0; i < fieldCount; i++) {
          const v = row[i];
          if (v === null || v === undefined) {
            dv.setInt32(o, -1, false);
            o += 4;
            continue;
          }
          const bytes = vals[i];
          dv.setInt32(o, bytes.length, false);
          o += 4;
          out.set(bytes, o);
          o += bytes.length;
        }
        return out;
      };

      const flushBatch = async () => {
        if (batch.length > 0) {
          // Enforce maxBytes and update progress before sending this batch
          const bLen = batch.length;
          // Resolve maxBytes from options or adapter defaults
          let __fromDefaults__: { maxChunkSize: number; maxBytes: number } = { maxChunkSize: 256 * 1024, maxBytes: 0 };
          try {
            const __defaults__ =
              (pool as any)?.getCopyDefaults?.() || (reserved as any)?.getCopyDefaults?.() || undefined;
            if (__defaults__?.from) {
              __fromDefaults__ = __defaults__.from;
            }
          } catch {}
          const maxBytes =
            options && typeof (options as any).maxBytes === "number" && (options as any).maxBytes > 0
              ? Number((options as any).maxBytes)
              : Math.max(0, Math.trunc(Number(__fromDefaults__.maxBytes) || 0));

          if (maxBytes && bytesSent + bLen > maxBytes) {
            throw new Error("copyFrom: maxBytes exceeded");
          }

          (reserved as any).copySendData(batch);
          bytesSent += bLen;
          chunksSent += 1;
          notifyProgress();

          {
            await new Promise<void>(resolve => {
              let settled = false;
              (pool as any).awaitWritableFor(reserved, () => {
                if (!settled) {
                  settled = true;
                  resolve();
                }
              });
              // Fallback to avoid hanging if there's no backpressure
              queueMicrotask(() => {
                if (!settled) {
                  settled = true;
                  resolve();
                }
              });
            });
          }
          batch = "";
        }
      };

      const addToBatch = async (chunk: string) => {
        batch += chunk;
        if (batch.length >= BATCH_SIZE) {
          await flushBatch();
        }
      };

      // Send data depending on type
      if (typeof data === "string") {
        if (aborted) throw new Error("AbortError");
        const payload = sanitizeString(data);
        type __CopyDefaults__ = {
          from: { maxChunkSize: number; maxBytes: number };
          to: { stream: boolean; maxBytes: number };
        };
        const __defaults__: __CopyDefaults__ | undefined =
          "getCopyDefaults" in pool
            ? (pool as unknown as { getCopyDefaults: () => __CopyDefaults__ }).getCopyDefaults()
            : undefined;
        const __fromDefaults__ = (__defaults__ && __defaults__.from) || { maxChunkSize: 256 * 1024, maxBytes: 0 };
        const maxBytes =
          options && typeof (options as any).maxBytes === "number" && (options as any).maxBytes > 0
            ? Number((options as any).maxBytes)
            : Math.max(0, Math.trunc(Number(__fromDefaults__.maxBytes) || 0));
        const maxChunkSize =
          options && typeof (options as any).maxChunkSize === "number" && (options as any).maxChunkSize > 0
            ? Number((options as any).maxChunkSize)
            : Math.max(0, Math.trunc(Number(__fromDefaults__.maxChunkSize) || 0));

        if (payload.length <= maxChunkSize) {
          if (maxBytes && bytesSent + payload.length > maxBytes) {
            throw new Error("copyFrom: maxBytes exceeded");
          }
          (reserved as any).copySendData(payload);
          bytesSent += payload.length;
          chunksSent += 1;
          notifyProgress();
        } else {
          for (let i = 0; i < payload.length; i += maxChunkSize) {
            const part = payload.slice(i, i + maxChunkSize);
            if (maxBytes && bytesSent + part.length > maxBytes) {
              throw new Error("copyFrom: maxBytes exceeded");
            }
            (reserved as any).copySendData(part);
            bytesSent += part.length;
            chunksSent += 1;
            notifyProgress();
            {
              await new Promise<void>(resolve => {
                let settled = false;
                (pool as any).awaitWritableFor(reserved, () => {
                  if (!settled) {
                    settled = true;
                    resolve();
                  }
                });
                // Fallback to avoid hanging if there's no backpressure
                queueMicrotask(() => {
                  if (!settled) {
                    settled = true;
                    resolve();
                  }
                });
              });
            }
          }
        }
        (reserved as any).copyDone();
        return;
      }

      const maybeIter = typeof data === "function" ? (data as () => Iterable<any[]>)() : (data as any);

      // Async iterable (rows or raw string/Uint8Array chunks)
      if (maybeIter && typeof maybeIter[Symbol.asyncIterator] === "function") {
        for await (const item of maybeIter as AsyncIterable<any>) {
          if (aborted) throw new Error("AbortError");
          if ($isArray(item)) {
            if (fmt === "binary") {
              const types = (options as any)?.binaryTypes as string[] | undefined;
              if (!types || !Array.isArray(types)) {
                throw new Error(
                  "Binary COPY format requires raw bytes or provide options.binaryTypes to enable automatic binary row encoding.",
                );
              }
              if (types.length !== (columns?.length ?? types.length)) {
                throw new Error("binaryTypes length must match number of columns for COPY FROM.");
              }
              await flushBatch();
              // header once
              sendBinaryHeader();
              const payload = encodeBinaryRow(item, types);
              (reserved as any).copySendData(payload);
              bytesSent += payload.byteLength;
              chunksSent += 1;
              notifyProgress();
              await new Promise<void>(resolve => {
                let settled = false;
                (pool as any).awaitWritableFor(reserved, () => {
                  if (!settled) {
                    settled = true;
                    resolve();
                  }
                });
                queueMicrotask(() => {
                  if (!settled) {
                    settled = true;
                    resolve();
                  }
                });
              });
            } else {
              // text/csv: treat as row[]
              await addToBatch(serializeRow(item));
            }
          } else if (typeof item === "string") {
            // raw string chunk
            await addToBatch(sanitizeString(item));
          } else if (item && (item as any).byteLength !== undefined) {
            // raw bytes (Uint8Array or ArrayBuffer) - flush and send directly
            await flushBatch();
            const u8raw = item instanceof Uint8Array ? item : new Uint8Array(item as ArrayBuffer);
            // For binary format, send raw bytes as-is; for text/csv, sanitize NUL bytes if requested
            const src = fmt === "binary" ? u8raw : sanitizeBytes(u8raw);
            type __CopyDefaults__ = {
              from: { maxChunkSize: number; maxBytes: number };
              to: { stream: boolean; maxBytes: number };
            };
            const __defaults__: __CopyDefaults__ | undefined =
              "getCopyDefaults" in pool
                ? (pool as unknown as { getCopyDefaults: () => __CopyDefaults__ }).getCopyDefaults()
                : undefined;
            const __fromDefaults__ = (__defaults__ && __defaults__.from) || { maxChunkSize: 256 * 1024, maxBytes: 0 };
            const maxBytes =
              options && typeof (options as any).maxBytes === "number" && (options as any).maxBytes > 0
                ? Number((options as any).maxBytes)
                : Math.max(0, Math.trunc(Number(__fromDefaults__.maxBytes) || 0));
            const maxChunkSize =
              options && typeof (options as any).maxChunkSize === "number" && (options as any).maxChunkSize > 0
                ? Number((options as any).maxChunkSize)
                : Math.max(0, Math.trunc(Number(__fromDefaults__.maxChunkSize) || 0));

            if (src.byteLength <= maxChunkSize) {
              if (maxBytes && bytesSent + src.byteLength > maxBytes) {
                throw new Error("copyFrom: maxBytes exceeded");
              }
              (reserved as any).copySendData(src);
              bytesSent += src.byteLength;
              chunksSent += 1;
              notifyProgress();
            } else {
              for (let i = 0; i < src.byteLength; i += maxChunkSize) {
                const part = src.subarray(i, Math.min(src.byteLength, i + maxChunkSize));
                if (maxBytes && bytesSent + part.byteLength > maxBytes) {
                  throw new Error("copyFrom: maxBytes exceeded");
                }
                (reserved as any).copySendData(part);
                bytesSent += part.byteLength;
                chunksSent += 1;
                notifyProgress();
                {
                  await new Promise<void>(resolve => {
                    let settled = false;
                    (pool as any).awaitWritableFor(reserved, () => {
                      if (!settled) {
                        settled = true;
                        resolve();
                      }
                    });
                    queueMicrotask(() => {
                      if (!settled) {
                        settled = true;
                        resolve();
                      }
                    });
                  });
                }
              }
            }
          } else {
            // fallback: attempt to serialize as a row
            await addToBatch(serializeRow(item));
          }
        }
        await flushBatch();
        // If we sent any binary rows via encoder, send trailer before done.
        sendBinaryTrailer();
        (reserved as any).copyDone();
        return;
      }

      // Sync iterable (rows or raw string/Uint8Array chunks)
      if (maybeIter && typeof maybeIter[Symbol.iterator] === "function") {
        for (const item of maybeIter as Iterable<any>) {
          if ($isArray(item)) {
            if (fmt === "binary") {
              const types = (options as any)?.binaryTypes as string[] | undefined;
              if (!types || !Array.isArray(types)) {
                throw new Error(
                  "Binary COPY format requires raw bytes or provide options.binaryTypes to enable automatic binary row encoding.",
                );
              }
              if (types.length !== (columns?.length ?? types.length)) {
                throw new Error("binaryTypes length must match number of columns for COPY FROM.");
              }
              await flushBatch();
              sendBinaryHeader();
              const payload = encodeBinaryRow(item, types);
              (reserved as any).copySendData(payload);
              bytesSent += payload.byteLength;
              chunksSent += 1;
              notifyProgress();
              // If awaitWritable exists on reserved, also use it
              if (typeof (reserved as any).awaitWritable === "function") {
                await new Promise<void>(resolve => {
                  let settled = false;
                  (reserved as any).awaitWritable(() => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                  queueMicrotask(() => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                });
              } else {
                await new Promise<void>(resolve => {
                  let settled = false;
                  (pool as any).awaitWritableFor(reserved, () => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                  queueMicrotask(() => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                });
              }
            } else {
              await addToBatch(serializeRow(item));
            }
          } else if (typeof item === "string") {
            await addToBatch(sanitizeString(item));
          } else if (item && (item as any).byteLength !== undefined) {
            // raw bytes (Uint8Array or ArrayBuffer) - flush and send directly
            await flushBatch();
            const u8raw = item instanceof Uint8Array ? item : new Uint8Array(item as ArrayBuffer);
            const src = fmt === "binary" ? u8raw : sanitizeBytes(u8raw);
            type __CopyDefaults__ = {
              from: { maxChunkSize: number; maxBytes: number };
              to: { stream: boolean; maxBytes: number };
            };
            const __defaults__: __CopyDefaults__ | undefined =
              "getCopyDefaults" in pool
                ? (pool as unknown as { getCopyDefaults: () => __CopyDefaults__ }).getCopyDefaults()
                : undefined;
            const __fromDefaults__ = (__defaults__ && __defaults__.from) || { maxChunkSize: 256 * 1024, maxBytes: 0 };
            const maxBytes =
              options && typeof (options as any).maxBytes === "number" && (options as any).maxBytes > 0
                ? Number((options as any).maxBytes)
                : Math.max(0, Math.trunc(Number(__fromDefaults__.maxBytes) || 0));
            const maxChunkSize =
              options && typeof (options as any).maxChunkSize === "number" && (options as any).maxChunkSize > 0
                ? Number((options as any).maxChunkSize)
                : Math.max(0, Math.trunc(Number(__fromDefaults__.maxChunkSize) || 0));

            const sendAwaitWritable = async () => {
              if (typeof (reserved as any).awaitWritable === "function") {
                await new Promise<void>(resolve => {
                  let settled = false;
                  (reserved as any).awaitWritable(() => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                  // Fallback to avoid hanging if there's no backpressure
                  queueMicrotask(() => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                });
              } else {
                await new Promise<void>(resolve => {
                  let settled = false;
                  (pool as any).awaitWritableFor(reserved, () => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                  queueMicrotask(() => {
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                  });
                });
              }
            };
            if (src.byteLength <= maxChunkSize) {
              if (maxBytes && bytesSent + src.byteLength > maxBytes) {
                throw new Error("copyFrom: maxBytes exceeded");
              }
              (reserved as any).copySendData(src);
              bytesSent += src.byteLength;
              chunksSent += 1;
              notifyProgress();
              await sendAwaitWritable();
            } else {
              for (let i = 0; i < src.byteLength; i += maxChunkSize) {
                const part = src.subarray(i, Math.min(src.byteLength, i + maxChunkSize));
                if (maxBytes && bytesSent + part.byteLength > maxBytes) {
                  throw new Error("copyFrom: maxBytes exceeded");
                }
                (reserved as any).copySendData(part);
                bytesSent += part.byteLength;
                chunksSent += 1;
                notifyProgress();
                await sendAwaitWritable();
              }
            }
          } else {
            await addToBatch(serializeRow(item));
          }
        }
        await flushBatch();
        sendBinaryTrailer();
        (reserved as any).copyDone();
        return;
      }

      // Array of arrays
      if (Array.isArray(data)) {
        // Binary format does not support automatic row serialization
        if (fmt === "binary") {
          throw new Error(
            "Binary COPY format requires raw bytes (Uint8Array/ArrayBuffer) or an iterable of binary chunks. Direct arrays cannot be serialized to binary format.",
          );
        }
        for (const row of data as any[]) {
          if (aborted) throw new Error("AbortError");
          await addToBatch(serializeRow(row));
        }
        await flushBatch();
        (reserved as any).copyDone();
        return;
      }

      // Fallback: treat as string
      if (aborted) throw new Error("AbortError");
      const fallback = sanitizeString(String(data ?? ""));
      (reserved as any).copySendData(fallback);
      bytesSent += fallback.length;
      chunksSent += 1;
      notifyProgress();
      (reserved as any).copyDone();
    };

    try {
      // Register one-shot onCopyStart to feed rows
      if (typeof (reserved as any).onCopyStart === "function") {
        (reserved as any).onCopyStart(() => {
          // Properly handle errors during data feeding
          feedData().catch(feedErr => {
            try {
              // Send CopyFail to server to abort the COPY operation
              if (typeof (reserved as any).copyFail === "function") {
                (reserved as any).copyFail(String(feedErr?.message || feedErr || "Error feeding data"));
              }
            } catch {}
          });
        });
      }

      // Build and run COPY ... FROM STDIN
      const cols = (columns ?? []).map(c => escapeIdentifier(String(c))).join(", ");
      const tableName = escapeIdentifier(String(table));
      // If automatic binary encoding is requested, validate column OIDs match expected types
      if (fmt === "binary" && options && Array.isArray((options as any).binaryTypes)) {
        const typeTokens = (options as any).binaryTypes as string[];
        if (typeTokens.length !== (columns?.length ?? typeTokens.length)) {
          throw new Error("binaryTypes length must match number of columns for COPY FROM.");
        }
        // Fetch column OIDs in the provided order using array_position for stable ordering
        const colNames = columns ?? [];
        // Determine schema and relation name (unquoted) for OID validation
        const rawTable = String(table).replaceAll('"', "");
        let schemaName: string | null = null;
        let relName = rawTable;
        const dotIndex = rawTable.indexOf(".");
        if (dotIndex !== -1) {
          schemaName = rawTable.slice(0, dotIndex);
          relName = rawTable.slice(dotIndex + 1);
        }

        // Fetch all columns and validate in JS according to the provided columns[] order
        const q = `
          SELECT a.attname::text AS name, a.atttypid::oid AS oid
          FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = $1
            AND ($2::text IS NULL OR n.nspname = $2)
            AND a.attnum > 0 AND NOT a.attisdropped
        `;
        const rows = await (reserved as any).unsafe(q, [relName, schemaName]);
        // Build expected OIDs for provided type tokens
        const expectedOids: number[] = typeTokens.map(tok => {
          if (tok.endsWith("[]")) {
            const arrOid = TYPE_ARRAY_OID[tok];
            if (!arrOid) throw new Error(`Unsupported array type for validation: ${tok}`);
            return arrOid;
          }
          // map varchar/bpchar to their OIDs, otherwise base TYPE_OID
          const base =
            TYPE_OID[tok] ?? (tok === "varchar" ? TYPE_OID.varchar : tok === "bpchar" ? TYPE_OID.bpchar : undefined);
          if (!base && base !== 0) throw new Error(`Unsupported type for validation: ${tok}`);
          // Column OID must be the base type OID when not array
          return base!;
        });
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error("Could not resolve column OIDs for validation.");
        }
        const oidByName = new Map<string, number>();
        for (const r of rows) {
          if (typeof r?.name === "string" && typeof r?.oid === "number") {
            oidByName.set(r.name, r.oid);
          }
        }
        for (let i = 0; i < expectedOids.length; i++) {
          const colName = String(colNames[i] ?? `col${i + 1}`);
          const got = oidByName.get(colName);
          const want = expectedOids[i];
          if (typeof got !== "number" || got !== want) {
            throw new Error(
              `COPY binaryTypes validation failed for column "${colName}": expected OID ${want}, got ${got}`,
            );
          }
        }
      }
      let sqlText = cols ? `COPY ${tableName} (${cols}) FROM STDIN` : `COPY ${tableName} FROM STDIN`;
      if (fmt === "csv") {
        const delim = options?.delimiter;
        const nullStr = options?.null;
        const delimOpt =
          delim && String(delim).length > 0 ? `, DELIMITER '${String(delim)[0].replaceAll("'", "''")}'` : "";
        const nullOpt = nullStr != null ? `, NULL '${String(nullToken).replaceAll("'", "''")}'` : "";
        sqlText += ` (FORMAT CSV${delimOpt}${nullOpt})`;
      } else if (fmt === "binary") {
        sqlText += ` (FORMAT BINARY)`;
      }

      // Handle AbortSignal: if aborted before issuing query
      if (aborted) throw new Error("AbortError");

      // Apply COPY FROM timeout default (if provided) before issuing the command
      try {
        const __defaults__ = (reserved as any)?.getCopyDefaults?.() || (pool as any)?.getCopyDefaults?.() || undefined;
        const __fromDefaults__ = (__defaults__ && __defaults__.from) || {
          maxChunkSize: 256 * 1024,
          maxBytes: 0,
          timeout: 0,
        };
        const timeout =
          options && typeof (options as any).timeout === "number" && (options as any).timeout >= 0
            ? (options as any).timeout | 0
            : (__fromDefaults__.timeout ?? 0) | 0;
        if (typeof (reserved as any).setCopyTimeout === "function") {
          try {
            (reserved as any).setCopyTimeout(timeout);
          } catch {}
        }
      } catch {}

      const result = await (reserved as any).unsafe(sqlText);
      await closeReserved();
      return result;
    } catch (err) {
      // Ensure we send CopyFail if we haven't already
      try {
        if (typeof (reserved as any).copyFail === "function") {
          (reserved as any).copyFail(String(err?.message || err || "COPY operation failed"));
        }
      } catch {}
      await closeReserved();
      throw err;
    } finally {
      // detach abort listener
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort as any);
      }
    }
  };

  // Streaming COPY TO STDOUT helper:
  // Usage:
  //   for await (const chunk of sql.copyTo(`COPY (SELECT ...) TO STDOUT`)) {
  //     // chunk is string for text format, ArrayBuffer for binary
  //   }
  // or pass table/columns/options:
  //   for await (const chunk of sql.copyTo({
  //     table: "t",
  //     columns: ["a","b"],
  //     format: "csv",
  //     signal?: AbortSignal,
  //     onProgress?: (info: { bytesReceived: number; chunksReceived: number }) => void,
  //   })) { ... }
  sql.copyTo = function (queryOrOptions: string | CopyToOptions): AsyncIterable<string | ArrayBuffer> {
    const self = this;
    const makeQuery = () => {
      if (typeof queryOrOptions === "string") {
        return queryOrOptions;
      }
      const table = queryOrOptions.table;
      // Escape table identifier with same logic as copyFrom to handle schema-qualified names
      const tableName = '"' + String(table).replaceAll('"', '""').replaceAll(".", '"."') + '"';
      const cols = (queryOrOptions.columns ?? [])
        .map(c => '"' + String(c).replaceAll('"', '""').replaceAll(".", '"."') + '"')
        .join(", ");
      const fmt =
        queryOrOptions.format === "csv"
          ? " (FORMAT CSV)"
          : queryOrOptions.format === "binary"
            ? " (FORMAT BINARY)"
            : "";
      return `COPY ${tableName}${cols ? ` (${cols})` : ""} TO STDOUT${fmt}`;
    };

    return {
      async *[Symbol.asyncIterator](): AsyncIterator<string | ArrayBuffer> {
        const reserved = await self.reserve();
        const chunks: any[] = [];
        let done = false;
        let rejectErr: any = null;

        // Progress and abort state
        let bytesReceived = 0;
        let chunksReceived = 0;
        const notifyProgress = () => {
          try {
            if (typeof queryOrOptions !== "string") {
              queryOrOptions.onProgress?.({ bytesReceived, chunksReceived });
            }
          } catch {}
        };
        let aborted = false;
        const signal = typeof queryOrOptions === "string" ? undefined : queryOrOptions.signal;
        const onAbort = () => {
          aborted = true;
        };
        if (signal) {
          if (signal.aborted) onAbort();
          signal.addEventListener("abort", onAbort, { once: true });
        }

        // Register streaming handlers
        if (typeof (reserved as any).onCopyChunk === "function") {
          (reserved as any).onCopyChunk((chunk: any) => {
            chunks.push(chunk);
            try {
              // Update progress
              if (chunk instanceof ArrayBuffer) {
                bytesReceived += chunk.byteLength;
              } else if (typeof chunk === "string") {
                bytesReceived += (Buffer as any).byteLength
                  ? (Buffer as any).byteLength(chunk, "utf8")
                  : new TextEncoder().encode(chunk).byteLength;
              } else if (chunk?.byteLength != null) {
                bytesReceived += chunk.byteLength;
              }
              chunksReceived += 1;
              notifyProgress();
              // Guardrail: maxBytes
              type __CopyDefaults__ = {
                from: { maxChunkSize: number; maxBytes: number };
                to: { stream: boolean; maxBytes: number };
              };
              const __defaults__: __CopyDefaults__ | undefined =
                "getCopyDefaults" in pool
                  ? (pool as unknown as { getCopyDefaults: () => __CopyDefaults__ }).getCopyDefaults()
                  : undefined;
              const __toDefaults__ = (__defaults__ && __defaults__.to) || { stream: true, maxBytes: 0 };
              const toMax =
                typeof queryOrOptions === "string"
                  ? Math.max(0, Math.trunc(Number(__toDefaults__.maxBytes) || 0))
                  : typeof (queryOrOptions as any)?.maxBytes === "number" && (queryOrOptions as any).maxBytes > 0
                    ? Number((queryOrOptions as any).maxBytes)
                    : Math.max(0, Math.trunc(Number(__toDefaults__.maxBytes) || 0));
              if (toMax > 0 && bytesReceived > toMax) {
                rejectErr = new Error("copyTo: maxBytes exceeded");
                done = true;
              }
            } catch {}
          });
        }
        if (typeof (reserved as any).onCopyEnd === "function") {
          (reserved as any).onCopyEnd(() => {
            done = true;
          });
        }

        try {
          if (aborted) throw new Error("AbortError");
          // Enable streaming mode to avoid accumulation in Zig during COPY TO
          if (typeof (reserved as any).setCopyStreamingMode === "function") {
            try {
              const __defaults__ =
                (reserved as any)?.getCopyDefaults?.() || (pool as any)?.getCopyDefaults?.() || undefined;
              const __toDefaults__ = (__defaults__ && __defaults__.to) || { stream: true, maxBytes: 0, timeout: 0 };
              const stream =
                typeof queryOrOptions === "string"
                  ? __toDefaults__.stream
                  : queryOrOptions.stream !== undefined
                    ? !!queryOrOptions.stream
                    : __toDefaults__.stream;
              const timeout =
                typeof queryOrOptions === "string"
                  ? (__toDefaults__.timeout ?? 0)
                  : (queryOrOptions as any).timeout !== undefined
                    ? Math.max(0, (queryOrOptions as any).timeout | 0)
                    : (__toDefaults__.timeout ?? 0);

              if (typeof (reserved as any).setCopyTimeout === "function") {
                try {
                  (reserved as any).setCopyTimeout(timeout);
                } catch {}
              }
              (reserved as any).setCopyStreamingMode(stream);
            } catch {}
          }
          // Start COPY TO STDOUT
          const q = makeQuery();
          await (reserved as any).unsafe(q);

          // Drain chunks as they arrive; finish when done flag is set
          while (!done || chunks.length > 0) {
            if (aborted) {
              // Stop consumption early; close the reserved connection to abort server-side
              rejectErr = new Error("AbortError");
              break;
            }
            if (chunks.length === 0) {
              // yield to event loop
              await Promise.resolve();
              continue;
            }
            yield chunks.shift();
          }
        } catch (e) {
          rejectErr = e;
        } finally {
          try {
            if (typeof (reserved as any).setCopyStreamingMode === "function") {
              try {
                (reserved as any).setCopyStreamingMode(false);
              } catch {}
            }
            if (typeof (reserved as any).close === "function") {
              await (reserved as any).close();
            }
          } catch {}
          if (signal) {
            signal.removeEventListener("abort", onAbort as any);
          }
        }

        if (rejectErr) {
          throw rejectErr;
        }
      },
    };
  };

  // Helper to pipe COPY TO stream directly into a WritableStream or stream-like sink
  // Usage:
  //   await sql.copyToPipeTo({ table: "t", format: "binary" }, writable)
  // Where writable is a Web WritableStream or an object with write(), close()/end()
  sql.copyToPipeTo = async function (
    queryOrOptions: string | CopyToOptions,
    writable:
      | WritableStream<Uint8Array | string>
      | {
          write: (chunk: string | ArrayBuffer | Uint8Array) => unknown | Promise<unknown>;
          close?: () => unknown | Promise<unknown>;
          end?: () => unknown | Promise<unknown>;
        },
  ) {
    const iterable = this.copyTo(queryOrOptions);
    // Web WritableStream path
    if ((writable as any)?.getWriter) {
      const writer = (writable as any).getWriter();
      try {
        for await (const chunk of iterable) {
          // Normalize ArrayBuffer to Uint8Array for WritableStream
          if (chunk instanceof ArrayBuffer) {
            await writer.write(new Uint8Array(chunk));
          } else {
            await writer.write(chunk);
          }
        }
        await writer.close();
      } catch (e) {
        try {
          await writer.close();
        } catch {}
        throw e;
      }
      return;
    }
    // Generic stream-like sink with write()/close() or end()
    if (writable && typeof (writable as any).write === "function") {
      for await (const chunk of iterable) {
        await (writable as any).write(chunk);
      }
      if (typeof (writable as any).close === "function") {
        await (writable as any).close();
      } else if (typeof (writable as any).end === "function") {
        await (writable as any).end();
      }
      return;
    }
    throw new Error("copyToPipeTo: unsupported writable sink");
  };

  sql.rollbackDistributed = async function (name: string) {
    if (pool.closed) {
      throw pool.connectionClosedError();
    }

    if (!pool.getRollbackDistributedSQL) {
      throw Error(`This adapter doesn't support distributed transactions.`);
    }

    const sqlQuery = pool.getRollbackDistributedSQL(name);
    return await sql.unsafe(sqlQuery);
  };

  sql.commitDistributed = async function (name: string) {
    if (pool.closed) {
      throw pool.connectionClosedError();
    }

    if (!pool.getCommitDistributedSQL) {
      throw Error(`This adapter doesn't support distributed transactions.`);
    }

    const sqlQuery = pool.getCommitDistributedSQL(name);
    return await sql.unsafe(sqlQuery);
  };

  sql.beginDistributed = (name: string, fn: TransactionCallback) => {
    if (pool.closed) {
      return Promise.$reject(pool.connectionClosedError());
    }
    let callback = fn;

    if (typeof name !== "string") {
      return Promise.$reject($ERR_INVALID_ARG_VALUE("name", name, "must be a string"));
    }

    if (!$isCallable(callback)) {
      return Promise.$reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    const useReserved = pool.supportsReservedConnections?.() ?? true;
    pool.connect(onTransactionConnected.bind(null, callback, name, resolve, reject, false, true), useReserved);
    return promise;
  };

  sql.begin = (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
    if (pool.closed) {
      return Promise.$reject(pool.connectionClosedError());
    }
    let callback = fn;
    let options: string | undefined = options_or_fn as unknown as string;
    if ($isCallable(options_or_fn)) {
      callback = options_or_fn as unknown as TransactionCallback;
      options = undefined;
    } else if (typeof options_or_fn !== "string") {
      return Promise.$reject($ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string"));
    }
    if (!$isCallable(callback)) {
      return Promise.$reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    const useReserved = pool.supportsReservedConnections?.() ?? true;
    pool.connect(onTransactionConnected.bind(null, callback, options, resolve, reject, false, false), useReserved);
    return promise;
  };
  sql.connect = () => {
    if (pool.closed) {
      return Promise.$reject(pool.connectionClosedError());
    }

    if (pool.isConnected()) {
      return Promise.$resolve(sql);
    }

    let { resolve, reject, promise } = Promise.withResolvers();
    const onConnected = (err, connection) => {
      if (err) {
        return reject(err);
      }
      // we are just measuring the connection here lets release it
      pool.release(connection);
      resolve(sql);
    };

    pool.connect(onConnected);

    return promise;
  };

  sql.close = async (options?: { timeout?: number }) => {
    await pool.close(options);
  };

  sql[Symbol.asyncDispose] = () => sql.close();

  sql.flush = () => pool.flush();
  sql.options = connectionInfo;

  sql.transaction = sql.begin;
  sql.distributed = sql.beginDistributed;
  sql.end = sql.close;
  // Expose adapter-level COPY defaults on SQL instance
  sql.getCopyDefaults = () => pool.getCopyDefaults();
  sql.setCopyDefaults = (defaults: {
    from?: { maxChunkSize?: number; maxBytes?: number };
    to?: { stream?: boolean; maxBytes?: number };
  }) => {
    pool.setCopyDefaults(defaults);
    return sql;
  };

  return sql;
};

var lazyDefaultSQL: Bun.SQL;

function resetDefaultSQL(sql) {
  lazyDefaultSQL = sql;
  // this will throw "attempt to assign to readonly property"
  // Object.assign(defaultSQLObject, lazyDefaultSQL);
  // exportsObject.default = exportsObject.sql = lazyDefaultSQL;
}

function ensureDefaultSQL() {
  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }
}

var defaultSQLObject: Bun.SQL = function sql(strings, ...values) {
  if (new.target) {
    return SQL(strings);
  }

  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }

  return lazyDefaultSQL(strings, ...values);
} as Bun.SQL;

defaultSQLObject.reserve = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.reserve(...args);
};
defaultSQLObject.array = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.array(...args);
};
defaultSQLObject.commitDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.commitDistributed(...args);
};
defaultSQLObject.rollbackDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.rollbackDistributed(...args);
};
defaultSQLObject.distributed = defaultSQLObject.beginDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.beginDistributed(...args);
};

defaultSQLObject.connect = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.connect(...args);
};

defaultSQLObject.unsafe = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.unsafe(...args);
};

defaultSQLObject.file = (filename: string, ...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.file(filename, ...args);
};

defaultSQLObject.transaction = defaultSQLObject.begin = function (...args: Parameters<typeof lazyDefaultSQL.begin>) {
  ensureDefaultSQL();
  return lazyDefaultSQL.begin(...args);
} as Bun.SQL["begin"];

defaultSQLObject.end = defaultSQLObject.close = (...args: Parameters<typeof lazyDefaultSQL.close>) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.close(...args);
};
defaultSQLObject.flush = (...args: Parameters<typeof lazyDefaultSQL.flush>) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.flush(...args);
};
//define lazy properties
defineProperties(defaultSQLObject, {
  options: {
    get: () => {
      ensureDefaultSQL();
      return lazyDefaultSQL.options;
    },
  },
  [Symbol.asyncDispose]: {
    get: () => {
      ensureDefaultSQL();
      return lazyDefaultSQL[Symbol.asyncDispose];
    },
  },
});

SQL.SQLError = SQLError;
SQL.PostgresError = PostgresError;
SQL.SQLiteError = SQLiteError;
SQL.MySQLError = MySQLError;

// // Helper functions for native code to create error instances
// // These are internal functions used by Zig/C++ code
// export function $createPostgresError(
//   message: string,
//   code: string,
//   detail: string,
//   hint: string,
//   severity: string,
//   additionalFields?: Record<string, any>,
// ) {
//   const options = {
//     code,
//     detail,
//     hint,
//     severity,
//     ...additionalFields,
//   };
//   return new PostgresError(message, options);
// }

// export function $createSQLiteError(message: string, code: string, errno: number) {
//   return new SQLiteError(message, { code, errno });
// }

// export function $createSQLError(message: string) {
//   return new SQLError(message);
// }

export default {
  sql: defaultSQLObject,
  default: defaultSQLObject,
  SQL,
  Query,
  postgres: SQL,
  SQLError,
  PostgresError,
  MySQLError,
  SQLiteError,
};
