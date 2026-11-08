import type { PooledConnection as ServerConnection } from "internal/sql/pool";
import type { BaseQueryHandle } from "internal/sql/query";
import type { DatabaseAdapter, TransactionCommands } from "internal/sql/shared";

type Query = import("internal/sql/query").Query<any, any>;
type Adapter = DatabaseAdapter<any, any, any>;
type Pool = Adapter | (Adapter & Pick<InstanceType<typeof PostgresAdapter>, "listen">);
type QueryHandle = BaseQueryHandle<any>;
type QueryHandler = (query: Query, handle: QueryHandle) => void;
type TransactionCallback = (sql: Bun.SQL) => unknown;
type CloseOptions = { timeout?: number };

/// SQLite's is the Database itself.
interface PooledConnection {
  bindQuery?: ServerConnection["bindQuery"];
  flush?: ServerConnection["flush"];
  close(): void;
}

const {
  Query,
  SQLQueryFlags,
  onQuerySettled,
  symbols: { _flags, _strings, _waiter, _copy },
} = require("internal/sql/query");
const { PostgresAdapter } = require("internal/sql/postgres");
const { MySQLAdapter } = require("internal/sql/mysql");
const { SQLiteAdapter } = require("internal/sql/sqlite");
const { SQLHelper, SQLResultArray, transforms } = require("internal/sql/shared");
const { closeTimeoutMs } = require("internal/sql/pool");
const { parseOptions } = require("internal/sql/options");

const { SQLError, PostgresError, SQLiteError, MySQLError } = require("internal/sql/errors");
const { validateAbortSignal } = require("internal/validators");
const { resistStopPropagation } = require("internal/shared");
const AsyncContextFrame = require("internal/async_context_frame");

const defineProperty = Object.defineProperty;
const setPrototypeOf = Object.setPrototypeOf;
const hasOwn = Object.hasOwn;
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const arraySlice = Array.prototype.slice;

function noop() {}

function adapterFromOptions(options: Bun.SQL.__internal.DefinedOptions): Pool {
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

interface Target {
  client: Client;
  pool: Pool;
  flags: number;
  handler: QueryHandler;
}

class Client implements Target {
  client: Client = this;
  pool: Pool;
  options: Bun.SQL.__internal.DefinedOptions;
  flags: number;
  handler: QueryHandler = dispatchToPool.bind(this);
  reserve = reserve.bind(this);
  listen = listen.bind(this);
  array = array.bind(this);
  json = json.bind(this);

  constructor(pool: Pool, options: Bun.SQL.__internal.DefinedOptions & { bigint?: boolean }) {
    this.pool = pool;
    this.options = options;
    this.flags = options.bigint ? SQLQueryFlags.bigint : SQLQueryFlags.none;
  }
}

const enum Kind {
  reservation,
  transaction,
  savepoint,
}

/// Never references its handle: a FinalizationRegistry releases a reservation whose handle was dropped.
class Scope implements Target {
  client: Client;
  pool: Pool;
  flags: number;
  handler: QueryHandler = dispatch.bind(this);
  kind: Kind;
  /// null: it took the connection from the pool
  parent: Scope | null;
  /// null: over
  connection: PooledConnection | null;
  /// The caller's statements pass. close() and release() clear it in the call, COMMIT and ROLLBACK where they are handed over.
  accepting = true;
  finishing: Promise<any> | null = null;
  /// The callback is over and run() waits for the answer to the end. Only that answer settles the transaction.
  awaitingAnswer = false;
  error: Error | null = null;
  running = new Set<Query>();
  children = new Set<Scope>();
  whenIdle: (() => void) | null = null;
  onConnectionClosed: ((err: Error) => void) | null = null;

  statements: TransactionCommands | null = null;
  distributed = false;
  savepoints = 0;
  /// of a transaction that waits for the one before it on the reservation
  start: (() => void) | null = null;
  resolve: ((value: unknown) => void) | null = null;
  reject: ((reason: unknown) => void) | null = null;
  failure: { error: unknown } | null = null;

  constructor(client: Client, kind: Kind, parent: Scope | null, connection: PooledConnection | null) {
    this.client = client;
    this.pool = client.pool;
    this.flags = client.flags | SQLQueryFlags.allowUnsafeTransaction;
    this.kind = kind;
    this.parent = parent;
    this.connection = connection;
  }
}

function isTemplateObject(strings: readonly unknown[]) {
  if (!$isArray((strings as TemplateStringsArray).raw) || !hasOwn(strings, "raw")) {
    return false;
  }
  if (propertyIsEnumerable.$call(strings, "raw")) {
    throw $ERR_INVALID_ARG_VALUE(
      "strings",
      strings,
      "has an enumerable 'raw' property, so it is not a template object. Use sql.unsafe(), or define 'raw' with Object.defineProperty()",
    );
  }
  return true;
}

function tag(this: Target, strings: any, ...values: any[]) {
  if ($isArray(strings)) {
    if (!isTemplateObject(strings)) {
      return new SQLHelper(strings, values);
    }
  } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLHelper)) {
    return new SQLHelper([strings], values);
  }
  return new Query(strings, values, this.flags, this.handler, this.pool);
}

function unsafeQuery(target: Target, text: string, values: any, flags: number, handler: QueryHandler): Query {
  if (values == null) {
    values = [];
    flags |= SQLQueryFlags.simple;
  } else if ($isArray(values)) {
    values = arraySlice.$call(values);
    if (values.length === 0) {
      flags |= SQLQueryFlags.simple;
    }
  }
  return new Query(text, values, target.flags | SQLQueryFlags.unsafe | flags, handler, target.pool);
}

function unsafe(this: Target, text: string, values?: unknown) {
  return unsafeQuery(this, text, values, SQLQueryFlags.none, this.handler);
}

function rejectQuery(this: Query, err: Error) {
  this.reject(err);
}

function onFileRead(this: Target, query: Query, text: string) {
  const handle = query.setText(text);
  if (handle !== null) {
    this.handler(query, handle);
  }
}

function readFileThenDispatch(this: Target, query: Query) {
  (Bun.file(query[_strings] as string) as Blob).text().$then(onFileRead.bind(this, query), rejectQuery.bind(query));
}

function file(this: Target, path: string, values?: unknown) {
  return unsafeQuery(this, path, values, SQLQueryFlags.deferredText, readFileThenDispatch.bind(this));
}

function runOn(pool: Pool, pooledConnection: PooledConnection | null, query: Query, handle: QueryHandle) {
  try {
    const connection = pool.getConnectionForQuery(pooledConnection);
    query.active = true;
    handle.run(connection, query);
  } catch (err) {
    query.reject(err as Error);
  }
}

function onQueryConnected(
  this: Pool,
  query: Query,
  handle: QueryHandle,
  err: Error | null,
  pooledConnection: PooledConnection | null,
) {
  query[_waiter] = null;
  if (err) {
    // The caller dropped it while it waited. As in onQuerySettled(): one that is only started ends no process.
    if (this.closedAtOnce) {
      $pokePromiseAsHandled(query);
    }
    return query.reject(err);
  }
  pooledConnection!.bindQuery?.(query);
  runOn(this, pooledConnection, query, handle);
}

function dispatchToPool(this: Client, query: Query, handle: QueryHandle) {
  const pool = this.pool;
  if (pool.closed) {
    return query.reject(pool.connectionClosedError());
  }
  pool.connect((query[_waiter] = onQueryConnected.bind(pool, query, handle)));
}

function refusal(scope: Scope): Error {
  for (let around: Scope | null = scope; around !== null; around = around.parent) {
    const { error } = around;
    if (error !== null) {
      return error;
    }
  }
  return scope.kind === Kind.reservation
    ? scope.pool.connectionClosedError()
    : scope.pool.invalidTransactionStateError("cannot run a query after its transaction or savepoint ended");
}

function isIdle(scope: Scope) {
  return scope.running.size === 0 && scope.children.size === 0;
}

function settleIfIdle(scope: Scope) {
  const whenIdle = scope.whenIdle;
  if (whenIdle !== null && isIdle(scope)) {
    scope.whenIdle = null;
    whenIdle();
  }
}

function forget(this: Scope, query: Query) {
  this.running.delete(query);
  settleIfIdle(this);
}

function start(scope: Scope, query: Query, handle: QueryHandle) {
  scope.running.add(query);
  onQuerySettled(query, forget.bind(scope, query));
  runOn(scope.pool, scope.connection, query, handle);
}

/// A statement of the caller.
function dispatch(this: Scope, query: Query, handle: QueryHandle) {
  if (
    !this.accepting ||
    // SQLite ends a transaction inside some failing statements. What follows would run in autocommit.
    (this.kind !== Kind.reservation && this.pool.isInTransaction?.(this.connection) === false)
  ) {
    // as in onQuerySettled()
    $pokePromiseAsHandled(query);
    return query.reject(refusal(this));
  }
  start(this, query, handle);
}

/// BEGIN, and what follows the first statement of the end.
function dispatchOwn(this: Scope, query: Query, handle: QueryHandle) {
  if (this.connection === null) {
    return query.reject(refusal(this));
  }
  start(this, query, handle);
}

/// What the end of a scope fails with when the scope around it ended first. Never leaves this file.
const nothingToEnd = Symbol("nothingToEnd") as unknown as Error;

/// The first statement of the end. What was handed over before it still precedes it, what comes later is refused.
function dispatchEnd(this: Scope, commit: boolean, query: Query, handle: QueryHandle) {
  const connection = this.connection;
  if (connection === null) {
    return query.reject(nothingToEnd);
  }
  shut(this);
  abandonChildren(this, null);
  start(this, query, handle);
  // SQLite has run it. A COMMIT that failed left the transaction open.
  if (commit && this.kind === Kind.transaction && this.pool.isInTransaction?.(connection) === true) {
    send(this, this.statements!.ROLLBACK, dispatchOwn.bind(this)).then(undefined, noop);
  }
}

function send(scope: Scope, text: string, handler: QueryHandler): Query {
  return new Query(
    text,
    [],
    scope.flags | SQLQueryFlags.unsafe | SQLQueryFlags.simple | SQLQueryFlags.internal,
    handler,
    scope.pool,
  );
}

function shut(scope: Scope) {
  scope.accepting = false;
  // A savepoint is a part of its transaction. A transaction is not a part of its reservation.
  if (scope.kind !== Kind.reservation) {
    for (const child of scope.children) {
      shut(child);
    }
  }
}

/// `reason`: of a close() that takes the connection away. cancel() then only stops the work on the server.
function cancelRunning(scope: Scope, reason?: Error) {
  for (const query of scope.running) {
    if (!(query[_flags] & SQLQueryFlags.internal)) {
      if (reason !== undefined) {
        query.reject(reason);
      }
      query.cancel();
    }
  }
  for (const child of scope.children) {
    cancelRunning(child, reason);
  }
}

const kindNames = ["reservation", "transaction", "savepoint"];

/// A COPY stream that is open when its scope ends would hold the connection for ever. Returns the queries it told so.
function abandonCopies(scope: Scope, ended: Scope, copies: Query[] = []) {
  for (const query of scope.running) {
    if (query[_flags] & SQLQueryFlags.copy) {
      query[_copy].abandon(`the ${kindNames[ended.kind]} ended before the COPY stream did`);
      copies.push(query);
    }
  }
  // as in shut()
  if (scope.kind !== Kind.reservation) {
    for (const child of scope.children) {
      abandonCopies(child, ended, copies);
    }
  }
  return copies;
}

/// The transactions of a reservation run one at a time, so the oldest that is left has not started.
function startNextTransaction(reservation: Scope) {
  for (const next of reservation.children) {
    const start = next.start!;
    next.start = null;
    return start();
  }
}

/// Over, in order: the end was answered, or release(). The connection goes back to where it came from.
function leave(scope: Scope, prepared = false) {
  const connection = scope.connection;
  if (connection === null) {
    return;
  }
  scope.connection = null;
  scope.accepting = false;
  abandonChildren(scope, null);
  const parent = scope.parent;
  if (parent !== null) {
    parent.children.delete(scope);
    if (parent.kind === Kind.reservation) {
      startNextTransaction(parent);
    }
    settleIfIdle(parent);
    return;
  }
  scope.pool.detachConnectionCloseHandler(connection, scope.onConnectionClosed!);
  if (scope.kind === Kind.reservation) {
    reservations!.unregister(scope);
  }
  scope.pool.release(connection, prepared);
}

/// Over, out of order: the connection is lost (`err`), or the scope around it ended. Nothing is sent.
function abandon(scope: Scope, err: Error | null) {
  if (scope.connection === null) {
    return;
  }
  scope.connection = null;
  scope.accepting = false;
  scope.error ??= err;
  if (err !== null) {
    for (const query of scope.running) {
      query.reject(err);
    }
  }
  abandonChildren(scope, err);
  // savepoint() settles when its callback does.
  if (scope.kind === Kind.transaction && !scope.awaitingAnswer) {
    const failure = scope.failure;
    settle(scope, scope.reject, failure !== null && err !== null ? withCause(err, failure.error) : refusal(scope));
  }
  const whenIdle = scope.whenIdle;
  if (whenIdle !== null) {
    scope.whenIdle = null;
    whenIdle();
  }
}

function abandonChildren(scope: Scope, err: Error | null) {
  const children = scope.children;
  for (const child of children) {
    abandon(child, err);
  }
  children.clear();
}

function onConnectionClosed(this: Scope, err: Error) {
  const connection = this.connection;
  if (connection === null) {
    return;
  }
  abandon(this, err);
  if (this.kind === Kind.reservation) {
    reservations!.unregister(this);
  }
  this.pool.release(connection);
}

function ownConnection(scope: Scope) {
  scope.pool.attachConnectionCloseHandler(
    scope.connection,
    (scope.onConnectionClosed = onConnectionClosed.bind(scope)),
  );
}

/// A lost connection rejects everything on it with one error object, so the cause goes on a copy.
function withCause(error: unknown, cause: unknown) {
  if (!Error.isError(error) || "cause" in error) {
    return error;
  }
  const copy = new Error(error.message, { cause });
  setPrototypeOf(copy, Object.getPrototypeOf(error));
  return Object.assign(copy, error);
}

function stopWaiting(timer: ReturnType<typeof setTimeout>, resolve: () => void) {
  clearTimeout(timer);
  resolve();
}

function idleOrTimeout(scope: Scope, ms: number): Promise<void> | undefined {
  if (ms === 0 || isIdle(scope)) {
    return;
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer: NodeJS.Timeout = setTimeout(resolve, ms);
  timer.unref();
  scope.whenIdle = stopWaiting.bind(null, timer, resolve);
  return promise;
}

/// A query that outlives the scope keeps the scope, so the scope lets go of the promise.
function settle(scope: Scope, settler: ((value: unknown) => void) | null, value: unknown) {
  scope.resolve = scope.reject = scope.failure = null;
  settler?.(value);
}

function finish(scope: Scope, commit: boolean, grace: number | undefined): Promise<any> {
  return (scope.finishing ??= end(scope, commit, grace));
}

async function end(scope: Scope, commit: boolean, grace: number | undefined) {
  let prepared = false;
  try {
    if (grace !== undefined) {
      const idle = idleOrTimeout(scope, grace);
      if (idle !== undefined) {
        await idle;
      }
      cancelRunning(scope);
    }
    if (scope.connection === null) {
      throw nothingToEnd;
    }
    // SQLite rolled it back by itself.
    if (!commit && scope.pool.isInTransaction?.(scope.connection) === false) {
      return;
    }
    const { BEFORE_COMMIT_OR_ROLLBACK, COMMIT, ROLLBACK } = scope.statements!;
    const last = commit ? COMMIT : ROLLBACK;
    if (BEFORE_COMMIT_OR_ROLLBACK) {
      await send(scope, BEFORE_COMMIT_OR_ROLLBACK, dispatchEnd.bind(scope, false));
      const answer = await send(scope, last, dispatchOwn.bind(scope));
      prepared = commit;
      return answer;
    }
    try {
      return await send(scope, last, dispatchEnd.bind(scope, commit));
    } catch (err) {
      // A savepoint whose RELEASE failed is still there.
      if (commit && scope.kind === Kind.savepoint && scope.connection !== null) {
        await send(scope, ROLLBACK, dispatchOwn.bind(scope)).then(undefined, noop);
      }
      throw err;
    }
  } finally {
    leave(scope, prepared);
  }
}

async function run(scope: Scope, callback: TransactionCallback) {
  const parent = scope.parent;
  try {
    // SAVEPOINT is a statement of the scope that savepoint() was called on: it goes through that scope's gate.
    await (scope.kind === Kind.savepoint
      ? send(parent!, scope.statements!.BEGIN, parent!.handler)
      : send(scope, scope.statements!.BEGIN, dispatchOwn.bind(scope)));
  } catch (err) {
    leave(scope);
    return settle(scope, scope.reject, err);
  }
  // close() or the loss of the connection came first
  if (!scope.accepting) {
    if (scope.finishing === null && scope.connection !== null) {
      await finish(scope, false, undefined).$then(undefined, noop);
    }
    return settle(scope, scope.reject, refusal(scope));
  }

  let result: unknown;
  try {
    result = await callback(makeHandle(scope));
    // A result is an array too, and Promise.all would copy it without its count, command and columns.
    if ($isArray(result) && !SQLResultArray.isResult(result)) {
      result = await Promise.all(result);
    }
  } catch (error) {
    scope.failure = { error };
  }
  if (!isIdle(scope)) {
    const copies = abandonCopies(scope, scope);
    if (copies.length > 0) {
      shut(scope);
    }
    for (let i = 0; i < copies.length; i++) {
      try {
        await copies[i];
      } catch (error) {
        scope.failure ??= { error };
      }
    }
  }
  const failure = scope.failure;

  const closing = scope.finishing;
  if (closing !== null || scope.connection === null) {
    if (closing !== null) {
      await closing.$then(undefined, noop);
    }
    return settle(scope, scope.reject, failure !== null ? failure.error : refusal(scope));
  }

  let answer: { command?: string | null } | undefined;
  scope.awaitingAnswer = true;
  try {
    answer = await finish(scope, failure === null, undefined);
  } catch (err) {
    if (failure === null) {
      return settle(scope, scope.reject, err === nothingToEnd ? refusal(scope) : err);
    }
    return settle(scope, scope.reject, err === nothingToEnd ? failure.error : withCause(err, failure.error));
  }
  if (failure !== null) {
    return settle(scope, scope.reject, failure.error);
  }
  // PostgreSQL answers the COMMIT of an aborted transaction with the tag ROLLBACK.
  if (scope.kind === Kind.transaction && answer?.command === "ROLLBACK") {
    return settle(
      scope,
      scope.reject,
      new PostgresError("COMMIT was rolled back by the server because the transaction was already aborted", {
        code: "ERR_POSTGRES_COMMIT_ROLLED_BACK",
      }),
    );
  }
  settle(scope, scope.resolve, result);
}

function transactionCommands(pool: Pool, options: string | undefined, distributed: boolean): TransactionCommands {
  if (!distributed) {
    return pool.getTransactionCommands(options);
  }
  const commands = pool.getDistributedTransactionCommands(options!);
  if (!commands) {
    throw new Error(`This adapter doesn't support distributed transactions.`);
  }
  return commands;
}

function onTransactionConnected(
  scope: Scope,
  callback: TransactionCallback,
  err: Error | null,
  pooledConnection: PooledConnection | null,
) {
  if (err) {
    return settle(scope, scope.reject, err);
  }
  scope.connection = pooledConnection;
  ownConnection(scope);
  run(scope, callback);
}

/// `fn.bind(undefined, scope, callback)` for later, when whoever gives up the connection calls it in their own async context.
function inCallerContext<Rest extends unknown[]>(
  fn: (scope: Scope, callback: TransactionCallback, ...rest: Rest) => void,
  scope: Scope,
  callback: TransactionCallback,
): (...rest: Rest) => void {
  // A transaction that runs as a disposed Bun.ModuleGraph never ends, and keeps the connection.
  return AsyncContextFrame.currentGraph() !== undefined
    ? fn.bind(undefined, scope, callback)
    : AsyncContextFrame.run.bind(undefined, AsyncContextFrame.current(), fn, undefined, scope, callback);
}

function begin(this: Client | Scope, distributed: boolean, optionsOrFn: unknown, fn?: unknown) {
  const pool = this.pool;
  const reservation = this instanceof Scope ? this : null;
  if (reservation !== null ? !reservation.accepting : pool.closed) {
    return Promise.$reject(pool.connectionClosedError());
  }

  let options = optionsOrFn as string | undefined;
  let callback = fn;
  if (distributed) {
    if (typeof optionsOrFn !== "string") {
      return Promise.$reject($ERR_INVALID_ARG_VALUE("name", optionsOrFn, "must be a string"));
    }
  } else if ($isCallable(optionsOrFn)) {
    callback = optionsOrFn;
    options = undefined;
  } else if (typeof optionsOrFn !== "string") {
    return Promise.$reject($ERR_INVALID_ARG_VALUE("options", optionsOrFn, "must be a string"));
  }
  if (!$isCallable(callback)) {
    return Promise.$reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
  }

  let statements: TransactionCommands;
  try {
    statements = transactionCommands(pool, options, distributed);
  } catch (err) {
    return Promise.$reject(err);
  }

  const { promise, resolve, reject } = Promise.withResolvers();
  const scope = new Scope(this.client, Kind.transaction, reservation, reservation && reservation.connection);
  scope.statements = statements;
  scope.distributed = distributed;
  scope.resolve = resolve;
  scope.reject = reject;
  if (reservation === null) {
    pool.connect(inCallerContext(onTransactionConnected, scope, callback as TransactionCallback), true);
  } else if (reservation.children.add(scope).size === 1) {
    run(scope, callback as TransactionCallback);
  } else {
    scope.start = inCallerContext(run, scope, callback as TransactionCallback);
  }
  return promise;
}

function transactionOf(scope: Scope) {
  while (scope.kind === Kind.savepoint) {
    scope = scope.parent!;
  }
  return scope;
}

function beginInsideTransaction(this: Scope, method: string) {
  throw this.pool.invalidTransactionStateError(
    transactionOf(this).distributed
      ? `cannot call ${method} inside a distributed transaction`
      : `cannot call ${method} inside a transaction use savepoint() instead`,
  );
}

/// savepoint(fn), savepoint(name, fn), and the untyped savepoint(fn, name).
function savepoint(this: Scope, nameOrFn: unknown, fnOrName?: unknown) {
  let name: unknown;
  let callback: unknown;
  if ($isCallable(fnOrName)) {
    callback = fnOrName;
    name = $isCallable(nameOrFn) ? "" : nameOrFn;
  } else {
    callback = nameOrFn;
    name = fnOrName;
  }
  if (name) {
    name = String(name).replace(/[^a-zA-Z0-9_]/g, "_");
  }

  const transaction = transactionOf(this);
  if (transaction.distributed) {
    return Promise.$reject(
      this.pool.invalidTransactionStateError("cannot call savepoint inside a distributed transaction"),
    );
  }
  if (!this.accepting) {
    return Promise.$reject(refusal(this));
  }
  if (!$isCallable(callback)) {
    return Promise.$reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
  }

  // the format of the postgres package
  const id = `s${transaction.savepoints++}${name ? `_${name}` : ""}`;
  const { promise, resolve, reject } = Promise.withResolvers();
  const scope = new Scope(this.client, Kind.savepoint, this, this.connection);
  scope.statements = {
    BEGIN: `SAVEPOINT ${id}`,
    COMMIT: `RELEASE SAVEPOINT ${id}`,
    ROLLBACK: `ROLLBACK TO SAVEPOINT ${id}`,
  };
  scope.resolve = resolve;
  scope.reject = reject;
  this.children.add(scope);
  run(scope, callback as TransactionCallback);
  return promise;
}

async function closeTransaction(this: Scope, options?: CloseOptions) {
  const grace = closeTimeoutMs(options) ?? 0;
  if (this.connection === null) {
    return;
  }
  const transaction = transactionOf(this);
  const { finishing } = transaction;
  if (finishing !== null) {
    await finishing.$then(undefined, noop);
    return;
  }
  shut(transaction);
  transaction.error = transaction.pool.connectionClosedError();
  try {
    await finish(transaction, false, grace);
  } catch (err) {
    if (err !== nothingToEnd) {
      throw err;
    }
  }
}

let reservations: FinalizationRegistry<Scope> | undefined;

function releaseDropped(scope: Scope) {
  release.$call(scope);
}

/// Does not wait for the hand-back: the caller can be the callback of a transaction that it waits for.
function release(this: Scope) {
  if (this.accepting) {
    this.accepting = false;
    if (isIdle(this)) {
      leave(this);
    } else {
      this.whenIdle = leave.bind(null, this);
      abandonCopies(this, this);
    }
  }
  return Promise.$resolve(undefined);
}

async function endReservation(scope: Scope, grace: number) {
  const idle = idleOrTimeout(scope, grace);
  if (idle !== undefined) {
    await idle;
  }
  const connection = scope.connection;
  if (connection !== null) {
    cancelRunning(scope, scope.pool.connectionClosedError());
    // onConnectionClosed gives it back
    connection.close();
  }
}

async function closeReservation(this: Scope, options?: CloseOptions) {
  const grace = closeTimeoutMs(options) ?? 0;
  if (this.accepting) {
    this.accepting = false;
    this.finishing = endReservation(this, grace);
  }
  await this.finishing;
}

interface PendingReservation {
  client: Client;
  signal: AbortSignal | undefined;
  resolve: (handle: Bun.ReservedSQL) => void;
  reject: (reason: unknown) => void;
  onConnected: ((err: Error | null, pooledConnection: PooledConnection | null) => void) | null;
  onAbort: (() => void) | null;
}

function onReserveConnected(this: PendingReservation, err: Error | null, pooledConnection: PooledConnection | null) {
  this.signal?.removeEventListener("abort", this.onAbort!);
  if (err) {
    return this.reject(err);
  }
  const scope = new Scope(this.client, Kind.reservation, null, pooledConnection);
  ownConnection(scope);
  const handle = makeHandle(scope);
  (reservations ??= new FinalizationRegistry(releaseDropped)).register(handle, scope, scope);
  this.resolve(handle);
}

/// Once the callback left the queue the caller owns a connection and must release() it: abort is a no-op.
function onReserveAbort(this: PendingReservation) {
  if (this.client.pool.cancelConnect(this.onConnected!)) {
    this.reject(this.signal!.reason);
  }
}

function reserve(this: Client, options?: { signal?: AbortSignal }) {
  const pool = this.pool;
  if (pool.closed) {
    return Promise.$reject(pool.connectionClosedError());
  }
  if (!pool.supportsReservedConnections) {
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

  const { promise, resolve, reject } = Promise.withResolvers<Bun.ReservedSQL>();
  const pending: PendingReservation = { client: this, signal, resolve, reject, onConnected: null, onAbort: null };
  pending.onConnected = onReserveConnected.bind(pending);
  if (signal === undefined) {
    pool.connect(pending.onConnected, true);
    return promise;
  }
  pending.onAbort = onReserveAbort.bind(pending);
  // A listener of the user on the same signal that calls stopImmediatePropagation() must not starve this one.
  signal.addEventListener("abort", pending.onAbort, resistStopPropagation({ __proto__: null, once: true }));
  pool.connect(pending.onConnected, true);
  // connect() can run user code (a function-valued password) that aborts before the callback is queued.
  if (signal.aborted) {
    onReserveAbort.$call(pending);
  }
  return promise;
}

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

function listenUnsupported() {
  return Promise.$reject(new Error("LISTEN/NOTIFY is not supported by this adapter (PostgreSQL only)"));
}

async function listen(this: Client, channel: unknown, onnotify: unknown, onlisten: unknown) {
  validateChannel(channel);
  validateCallback("onnotify", onnotify, false);
  validateCallback("onlisten", onlisten, true);
  const pool = this.pool;
  return "listen" in pool
    ? pool.listen(channel, onnotify as (payload: string) => void, onlisten as (() => void) | undefined)
    : listenUnsupported();
}

function notify(this: Target, channel: unknown, payload: unknown) {
  validateChannel(channel);
  if (payload === undefined) {
    payload = "";
  } else if (typeof payload !== "string") {
    throw $ERR_INVALID_ARG_TYPE("payload", "string", payload);
  }
  if (!("listen" in this.pool)) {
    return listenUnsupported();
  }
  // it is sent even when nobody awaits it
  return new Query(
    "SELECT pg_notify($1, $2)",
    [channel, payload],
    this.flags | SQLQueryFlags.unsafe,
    this.handler,
    this.pool,
  ).execute();
}

async function finishDistributed(this: Target, commit: boolean, name: string) {
  const text = this.pool.getFinishDistributedSQL(commit, name);
  return await unsafeQuery(this, text, undefined, SQLQueryFlags.none, this.handler).execute();
}

function array(this: Client, values: any[], typeNameOrID?: number | string) {
  return this.pool.array(values, typeNameOrID);
}

function json(this: Client, value: unknown) {
  const pool = this.pool;
  return pool.json ? pool.json(value) : JSON.stringify(value);
}

function onClientConnected(
  this: Pool,
  handle: Bun.SQL,
  resolve: (handle: Bun.SQL) => void,
  reject: (err: Error) => void,
  err: Error | null,
  pooledConnection: PooledConnection | null,
) {
  if (err) {
    return reject(err);
  }
  this.release(pooledConnection);
  resolve(handle);
}

function connectClient(this: Client, handle: Bun.SQL) {
  const pool = this.pool;
  if (pool.closed) {
    return Promise.$reject(pool.connectionClosedError());
  }
  if (pool.isConnected()) {
    return Promise.$resolve(handle);
  }
  const { promise, resolve, reject } = Promise.withResolvers<Bun.SQL>();
  pool.connect(onClientConnected.bind(pool, handle, resolve, reject));
  return promise;
}

function connectScope(this: Scope, handle: Bun.SQL) {
  return this.connection === null ? Promise.$reject(this.pool.connectionClosedError()) : Promise.$resolve(handle);
}

async function closeClient(this: Client, options?: CloseOptions) {
  await this.pool.close(options);
}

function flushClient(this: Client) {
  return this.pool.flush();
}

function flushScope(this: Scope) {
  const connection = this.connection;
  if (connection === null) {
    throw this.pool.connectionClosedError();
  }
  return connection.flush ? connection.flush() : this.pool.flush();
}

const handleName = { __proto__: null, value: "sql", configurable: true };

function makeHandle(target: Client | Scope) {
  const client = target.client;
  const handle: any = tag.bind(target);
  defineProperty(handle, "name", handleName);
  handle.unsafe = unsafe.bind(target);
  handle.file = file.bind(target);
  handle.notify = notify.bind(target);
  handle.commitDistributed = finishDistributed.bind(target, true);
  handle.rollbackDistributed = finishDistributed.bind(target, false);
  // reserve() takes another connection from the pool, whatever it is called on, as in the postgres package
  handle.reserve = client.reserve;
  handle.listen = client.listen;
  handle.array = client.array;
  handle.json = client.json;
  handle.options = client.options;
  if (target instanceof Client) {
    handle.connect = connectClient.bind(target, handle);
    handle.flush = flushClient.bind(target);
    handle.begin = handle.transaction = begin.bind(target, false);
    handle.beginDistributed = handle.distributed = begin.bind(target, true);
    handle.close = handle.end = closeClient.bind(target);
    handle[Symbol.asyncDispose] = closeClient.bind(target, undefined);
  } else {
    handle.connect = connectScope.bind(target, handle);
    handle.flush = flushScope.bind(target);
    if (target.kind === Kind.reservation) {
      handle.begin = handle.transaction = begin.bind(target, false);
      handle.beginDistributed = handle.distributed = begin.bind(target, true);
      handle.close = handle.end = closeReservation.bind(target);
      handle.release = handle[Symbol.dispose] = handle[Symbol.asyncDispose] = release.bind(target);
    } else {
      handle.begin = handle.transaction = beginInsideTransaction.bind(target, "begin");
      handle.beginDistributed = handle.distributed = beginInsideTransaction.bind(target, "beginDistributed");
      handle.savepoint = savepoint.bind(target);
      handle.close = handle.end = closeTransaction.bind(target);
      handle[Symbol.asyncDispose] = closeTransaction.bind(target, undefined);
    }
  }
  return setPrototypeOf(handle, SQLPrototype);
}

function SQL(
  stringOrUrlOrOptions: Bun.SQL.Options | string | undefined = undefined,
  definitelyOptionsButMaybeEmpty: Bun.SQL.Options = {},
): Bun.SQL {
  // Not `new.target !== SQL`: `new` on a Proxy of SQL works.
  if (new.target !== undefined && new.target.prototype !== SQLPrototype) {
    throw new TypeError(
      "Bun.SQL cannot be subclassed. Its methods are own properties of the client, so a subclass cannot override them. Wrap the client instead.",
    );
  }
  const options = parseOptions(stringOrUrlOrOptions, definitelyOptionsButMaybeEmpty);
  return makeHandle(new Client(adapterFromOptions(options), options));
}

// A builtin function has no `prototype`, and `instanceof` throws without one. A client is a function.
const SQLPrototype = Object.create(Function.prototype, {
  constructor: { value: SQL, writable: true, configurable: true },
});
defineProperty(SQL, "prototype", { value: SQLPrototype });

SQL.SQLError = SQLError;
SQL.PostgresError = PostgresError;
SQL.SQLiteError = SQLiteError;
SQL.MySQLError = MySQLError;
Object.assign(SQL, transforms);

let lazyDefaultSQL: any;

function defaultSQL() {
  // Shared by everything in the realm: not owned by whichever Bun.ModuleGraph uses it first.
  return (lazyDefaultSQL ??= AsyncContextFrame.run(undefined, SQL, undefined, undefined));
}

function callDefaultSQL(member: string, ...args: unknown[]) {
  return defaultSQL()[member].$apply(undefined, args);
}

function defaultSQLOptions() {
  return defaultSQL().options;
}

function defaultSQLAsyncDispose() {
  return defaultSQL()[Symbol.asyncDispose];
}

const defaultSQLObject: any = function sql(strings: any, options: any) {
  if (new.target) {
    return SQL(strings, options);
  }
  return defaultSQL().$apply(undefined, arguments);
};

const defaultSQLMembers = [
  "unsafe",
  "file",
  "notify",
  "commitDistributed",
  "rollbackDistributed",
  "reserve",
  "listen",
  "array",
  "json",
  "connect",
  "flush",
  "begin",
  "transaction",
  "beginDistributed",
  "distributed",
  "close",
  "end",
];
for (let i = 0; i < defaultSQLMembers.length; i++) {
  defaultSQLObject[defaultSQLMembers[i]] = callDefaultSQL.bind(undefined, defaultSQLMembers[i]);
}
defineProperty(defaultSQLObject, "options", { get: defaultSQLOptions });
defineProperty(defaultSQLObject, Symbol.asyncDispose, { get: defaultSQLAsyncDispose });
setPrototypeOf(defaultSQLObject, SQLPrototype);

// Bun.sql and Bun.SQL
export default {
  default: defaultSQLObject,
  SQL,
};
