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
const { validateAbortSignal } = require("internal/validators");
const { resistStopPropagation } = require("internal/shared");

const defineProperties = Object.defineProperties;

type TransactionCallback = (sql: (strings: string, ...values: any[]) => Query<any, any>) => Promise<any>;

enum ReservedConnectionState {
  acceptQueries = 1 << 0,
  closed = 1 << 1,
  released = 1 << 2,
}

interface TransactionState {
  connectionState: ReservedConnectionState;
  reject: (err: Error) => void;
  storedError?: Error | null | undefined;
  queries: Set<Query<any, any>>;
}

/// Bound as `this` to both callbacks of a reserve({ signal }) call, so each can
/// reach the other without a per-call closure.
interface ReserveAbortState {
  signal: AbortSignal;
  promiseWithResolvers: { promise: Promise<any>; resolve: (value: any) => void; reject: (reason?: any) => void };
  onConnected: ((err: Error | null, pooledConnection: any) => void) | null;
  onAbort: (() => void) | null;
}

function settleReservedTransaction(
  reservedTransaction: Set<Promise<void>>,
  finished: { promise: Promise<void>; resolve: () => void },
  settle: (value: any) => void,
  value: any,
) {
  reservedTransaction.delete(finished.promise);
  finished.resolve();
  settle(value);
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
    strings: string | TemplateStringsArray | import("internal/sql/shared.ts").SQLHelper<any> | Query<any, any>,
    values: any[],
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
    strings: string | TemplateStringsArray | import("internal/sql/shared.ts").SQLHelper<any> | Query<any, any>,
    values: any[],
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
    strings: string | TemplateStringsArray | import("internal/sql/shared.ts").SQLHelper<any> | Query<any, any>,
    values: any[],
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
    strings: string | TemplateStringsArray | import("internal/sql/shared.ts").SQLHelper<any> | Query<any, any>,
    values: any[],
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

  const listenable = "listen" in pool ? pool : null;
  function validateChannel(channel: unknown): asserts channel is string {
    if (typeof channel !== "string" || channel.length === 0) {
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must be a non-empty string");
    }
    if (channel.includes("\0")) {
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must not contain null bytes");
    }
    // PostgreSQL truncates longer identifiers, so notifications would arrive under a different name.
    if (Buffer.byteLength(channel) > 63) {
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must be at most 63 bytes");
    }
  }
  function validateCallback(name: string, fn: unknown, optional: boolean) {
    if (!$isCallable(fn) && !(optional && fn === undefined)) {
      throw $ERR_INVALID_ARG_TYPE(name, "function", fn);
    }
  }
  const listenUnsupported = () =>
    Promise.$reject(new Error("LISTEN/NOTIFY is not supported by this adapter (PostgreSQL only)"));
  const listen: Bun.SQL["listen"] = async (channel, onnotify, onlisten) => {
    validateChannel(channel);
    validateCallback("onnotify", onnotify, false);
    validateCallback("onlisten", onlisten, true);
    return listenable ? listenable.listen(channel, onnotify, onlisten) : listenUnsupported();
  };
  // .execute(): queries are lazy, and notify() must send even when not awaited.
  function makeNotify(target: { unsafe: Bun.SQL["unsafe"] }): Bun.SQL["notify"] {
    return (channel, payload) => {
      validateChannel(channel);
      if (payload === undefined) payload = "";
      else if (typeof payload !== "string") throw $ERR_INVALID_ARG_TYPE("payload", "string", payload);
      if (!listenable) return listenUnsupported();
      return target.unsafe("SELECT pg_notify($1, $2)", [channel, payload]).execute() as unknown as Promise<void>;
    };
  }

  // Never attach a handler to the caller's promise: it changes which rejections are reported as unhandled.
  function runReservedTransaction(
    reservedTransaction: Set<Promise<void>>,
    pooledConnection,
    callback: TransactionCallback,
    options: string | undefined,
    distributed: boolean,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const finished = Promise.withResolvers<void>();
    reservedTransaction.add(finished.promise);
    // lets just reuse the same code path as the transaction begin
    onTransactionConnected(
      callback,
      options,
      settleReservedTransaction.bind(null, reservedTransaction, finished, resolve),
      settleReservedTransaction.bind(null, reservedTransaction, finished, reject),
      true,
      distributed,
      null,
      pooledConnection,
    );
    return promise;
  }

  function onReserveConnected(this: Query<any, any>, err: Error | null, pooledConnection) {
    const { resolve, reject } = this;

    if (err) {
      return reject(err);
    }

    let reservedTransaction = new Set<Promise<void>>();

    const state: TransactionState = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      storedError: null,
      queries: new Set(),
    };

    function releaseReservation() {
      if (state.connectionState & ReservedConnectionState.released) return;
      state.connectionState |= ReservedConnectionState.released;
      pool.release(pooledConnection);
    }

    const onDisconnected = onTransactionDisconnected.bind(state);
    function onClose(err: Error) {
      onDisconnected(err);
      releaseReservation();
    }
    if (pooledConnection.onClose) {
      pooledConnection.onClose(onClose);
    }

    function reserved_sql(strings: string | TemplateStringsArray | SQLHelper<any> | Query<any, any>, ...values: any[]) {
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
    reserved_sql.reserve = (options?: { signal?: AbortSignal }) => sql.reserve(options);
    reserved_sql.array = sql.array;
    reserved_sql.listen = listen;
    reserved_sql.notify = makeNotify(reserved_sql);
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
      return runReservedTransaction(reservedTransaction, pooledConnection, callback, name, true);
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
      return runReservedTransaction(reservedTransaction, pooledConnection, callback, options, false);
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
      if (state.connectionState & ReservedConnectionState.released) {
        return Promise.$resolve(undefined);
      }
      // just release the connection back to the pool
      state.connectionState |= ReservedConnectionState.closed;
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      // Use adapter method to detach connection close handler
      if (pool.detachConnectionCloseHandler) {
        pool.detachConnectionCloseHandler(pooledConnection, onClose);
      }
      releaseReservation();
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

  function onReserveConnectedWithSignal(this: ReserveAbortState, err: Error | null, pooledConnection) {
    this.signal.removeEventListener("abort", this.onAbort!);
    onReserveConnected.$call(this.promiseWithResolvers, err, pooledConnection);
  }

  function onReserveAbort(this: ReserveAbortState) {
    // Once the callback left the queue a connection was handed out; the
    // caller owns it and must release() it, so abort becomes a no-op.
    if (pool.cancelReserve && pool.cancelReserve(this.onConnected!)) {
      this.promiseWithResolvers.reject(this.signal.reason);
    }
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
        if (!dontRelease) {
          pool.release(pooledConnection);
        }
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
          if (!dontRelease) {
            pool.release(pooledConnection);
          }
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
        if (!dontRelease) {
          pool.release(pooledConnection);
        }
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
    // every transaction_sql.close path converges here: cancel whatever is
    // still pending, roll the transaction back, and only then set the closed
    // bit (run_internal_transaction_sql rejects once it is set), so a later
    // COMMIT attempt fails with connectionClosedError instead of committing a
    // closed transaction. The pooled connection itself stays open; it is
    // released back to the pool by onTransactionConnected once the begin
    // callback settles.
    let closeTransactionPromise: Promise<void> | null = null;
    async function rollbackAndMarkClosed() {
      if (state.connectionState & ReservedConnectionState.closed) {
        // the connection dropped while close() was waiting; the server
        // already aborted the transaction so there is nothing to roll back
        return;
      }
      for (const query of state.queries) {
        (query as Query<any, any>).cancel();
      }
      try {
        if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
          await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
        }
        await run_internal_transaction_sql(ROLLBACK_COMMAND);
      } finally {
        // even when ROLLBACK fails the transaction must not be committable
        state.connectionState |= ReservedConnectionState.closed;
      }
    }
    function closeTransaction() {
      return (closeTransactionPromise ??= rollbackAndMarkClosed());
    }
    function transaction_sql(
      strings: string | TemplateStringsArray | import("internal/sql/shared.ts").SQLHelper<any> | Query<any, any>,
      ...values: any[]
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
    transaction_sql.reserve = (options?: { signal?: AbortSignal }) => sql.reserve(options);
    transaction_sql.array = sql.array;
    transaction_sql.listen = listen;
    transaction_sql.notify = makeNotify(transaction_sql);

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
          const { promise, resolve, reject } = Promise.withResolvers();
          // grace period: wait up to the timeout for the pending queries and
          // savepoints to settle before rolling back
          const pending_queries = Array.from(transactionQueries);
          const pending_savepoints = Array.from(transactionSavepoints);
          function settleClose() {
            clearTimeout(timer);
            closeTransaction().then(resolve, reject);
          }
          const timer = setTimeout(settleClose, timeout * 1000);
          timer.unref(); // dont block the event loop
          // allSettled: one rejecting query must not cut the grace period
          // short for the rest, and its rejection is observed here instead of
          // surfacing as an unhandled rejection
          Promise.allSettled([...pending_queries, ...pending_savepoints]).then(settleClose, settleClose);
          return promise;
        }
      }
      return closeTransaction();
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
        } else if (name) {
          name = String(name).replace(/[^a-zA-Z0-9_]/g, "_");
        }
        if (!$isCallable(savepoint_callback)) {
          throw $ERR_INVALID_ARG_VALUE("fn", savepoint_callback, "must be a function");
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

  sql.reserve = (options?: { signal?: AbortSignal }) => {
    if (pool.closed) {
      return Promise.$reject(pool.connectionClosedError());
    }

    // Check if adapter supports reserved connections
    if (pool.supportsReservedConnections && !pool.supportsReservedConnections()) {
      return Promise.$reject(new Error("This adapter doesn't support connection reservation"));
    }

    const signal = options?.signal;
    if (signal !== undefined) {
      try {
        validateAbortSignal(signal, "options.signal");
      } catch (err) {
        return Promise.$reject(err);
      }
      if (signal.aborted) {
        return Promise.$reject(signal.reason);
      }
    }

    // Try to reserve a connection - adapters that support it will handle appropriately
    const promiseWithResolvers = Promise.withResolvers();
    if (signal === undefined) {
      pool.connect(onReserveConnected.bind(promiseWithResolvers), true);
      return promiseWithResolvers.promise;
    }

    const state: ReserveAbortState = { signal, promiseWithResolvers, onConnected: null, onAbort: null };
    state.onConnected = onReserveConnectedWithSignal.bind(state);
    state.onAbort = onReserveAbort.bind(state);
    // resistStopPropagation: a user listener on the same signal calling
    // stopImmediatePropagation() must not starve the cancellation.
    signal.addEventListener("abort", state.onAbort, resistStopPropagation({ __proto__: null, once: true }));
    pool.connect(state.onConnected, true);
    // connect() can run user code synchronously (e.g. a function-valued
    // password) before queueing the callback; an abort from inside that window
    // finds nothing to cancel, so re-check. onReserveAbort is idempotent.
    if (signal.aborted) {
      onReserveAbort.$call(state);
    }
    return promiseWithResolvers.promise;
  };

  sql.array = (values: any[], typeNameOrID: number | string | undefined = undefined) => {
    return pool.array(values, typeNameOrID);
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
  sql.listen = listen;
  sql.notify = makeNotify(sql);
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
defaultSQLObject.listen = (...args: Parameters<typeof lazyDefaultSQL.listen>) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.listen(...args);
};
defaultSQLObject.notify = (...args: Parameters<typeof lazyDefaultSQL.notify>) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.notify(...args);
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
