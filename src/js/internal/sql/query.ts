import type { DatabaseAdapter, SQLHelper } from "./shared.ts";

const _resolve = Symbol("resolve");
const _reject = Symbol("reject");
const _handle = Symbol("handle");
const _queryStatus = Symbol("status");
const _handler = Symbol("handler");
const _strings = Symbol("strings");
const _values = Symbol("values");
const _flags = Symbol("flags");
const _results = Symbol("results");
const _adapter = Symbol("adapter");
const _waiter = Symbol("waiter");
const _settled = Symbol("settled");
const _copy = Symbol("copy");
const _onSettled = Symbol("onSettled");
const _pumped = Symbol("pumped");
const _outcome = Symbol("outcome");
const _failed = Symbol("failed");

const PublicPromise = Promise;

export interface BaseQueryHandle<Connection> {
  cancel?(): void;
  setMode(mode: SQLQueryResultMode): void;
  run(connection: Connection, query: Query<any, any>): void | Promise<void>;
}

export type { Query, SQLQueryResultMode };
export type QueryStrings = string | TemplateStringsArray | SQLHelper<any> | Query<any, any>;
class Query<T, Handle extends BaseQueryHandle<any>> extends PublicPromise<T> {
  public [_resolve]: (value: T) => void;
  public [_reject]: (reason?: Error) => void;
  public [_handle]: Handle | null;
  public [_handler]: (query: Query<T, Handle>, handle: Handle | null) => unknown;
  public [_queryStatus]: SQLQueryStatus;
  public [_strings]: QueryStrings;
  public [_values]: any[];
  public [_flags]: SQLQueryFlags;
  public [_waiter]: ((err: Error | null, connection: any) => void) | null;
  public [_settled]: Promise<void> | null;
  /// The callbacks of onQuerySettled() that have not run. wait() runs them itself: no microtask runs while it blocks.
  public [_onSettled]: Array<() => void> | null;
  /// The native connection it runs on, for wait().
  public [_pumped]: { pump(ms: number): number } | null;
  /// What it settled with, for executeSync().
  public [_outcome]: unknown;
  public [_failed]: boolean;
  /// What is behind the stream of a query with SQLQueryFlags.copy. No other query has the property.
  declare public [_copy]: { attach(handle: Handle): void; abandon(why: string): void };

  public readonly [_adapter]: DatabaseAdapter<any, any, Handle>;

  [Symbol.for("nodejs.util.inspect.custom")](): `Query { ${string} }` {
    const status = this[_queryStatus];

    let query = "";
    if ((status & SQLQueryStatus.active) != 0) query += "active ";
    if ((status & SQLQueryStatus.cancelled) != 0) query += "cancelled ";
    if ((status & SQLQueryStatus.executed) != 0) query += "executed ";
    if ((status & SQLQueryStatus.error) != 0) query += "error ";

    return `Query { ${query.trimEnd()} }`;
  }

  #createHandle(): Handle | null {
    try {
      const adapter = this[_adapter];
      const flags = this[_flags];
      const [sql, values] = adapter.normalizeQuery(this[_strings], this[_values]);
      const handle = adapter.createQueryHandle(sql, values, flags);
      const mode = (flags >> resultModeShift) & 3;
      if (mode !== SQLQueryResultMode.objects) {
        handle.setMode(mode);
      }
      if (flags & SQLQueryFlags.copy) {
        this[_copy].attach(handle);
      }
      return (this[_handle] = handle);
    } catch (err) {
      this.reject(err as Error);
      return null;
    }
  }

  #setMode(mode: SQLQueryResultMode) {
    this[_flags] = (this[_flags] & ~(3 << resultModeShift)) | (mode << resultModeShift);
    this[_handle]?.setMode(mode);
    return this;
  }

  constructor(
    strings: QueryStrings,
    values: any[],
    flags: number,
    handler,
    adapter: DatabaseAdapter<any, any, Handle>,
  ) {
    let resolve_: (value: T) => void, reject_: (reason?: any) => void;

    super((resolve, reject) => {
      resolve_ = resolve;
      reject_ = reject;
    });

    this[_adapter] = adapter;

    if (typeof strings === "string" && !(flags & SQLQueryFlags.unsafe)) {
      // identifier (cannot be executed in safe mode); the adapter that runs the statement quotes it
      if (strings.includes("\0")) {
        throw $ERR_INVALID_ARG_VALUE("name", strings, "must not contain null bytes");
      }
      flags |= SQLQueryFlags.notTagged;
    }

    this[_resolve] = resolve_!;
    this[_reject] = reject_!;
    this[_handle] = null;
    this[_handler] = handler;
    this[_queryStatus] = SQLQueryStatus.none;
    this[_strings] = strings;
    this[_values] = values;
    this[_flags] = flags;
    this[_waiter] = null;
    this[_settled] = null;
    this[_onSettled] = null;
    this[_pumped] = null;
    this[_outcome] = undefined;
    this[_failed] = false;

    this[_results] = null;
  }

  #run() {
    const { [_handler]: handler, [_queryStatus]: status, [_flags]: flags } = this;

    if (status & (SQLQueryStatus.executed | SQLQueryStatus.error)) {
      return;
    }

    if (flags & SQLQueryFlags.notTagged) {
      this.reject(this[_adapter].notTaggedCallError());
      return;
    }

    if (status & SQLQueryStatus.cancelled) {
      // as in onQuerySettled()
      $pokePromiseAsHandled(this);
      this.reject(this[_adapter].queryCancelledError());
      return;
    }

    this[_queryStatus] |= SQLQueryStatus.executed;
    let handle: Handle | null = null;
    if (!(flags & SQLQueryFlags.deferredText)) {
      handle = this.#createHandle();
      if (handle === null) {
        return;
      }
    }

    try {
      handler(this, handle);
    } catch (err) {
      this.reject(err as Error);
    }
  }

  setText(text: string): Handle | null {
    if (this[_queryStatus] & SQLQueryStatus.error) {
      return null;
    }
    this[_strings] = text;
    this[_flags] &= ~SQLQueryFlags.deferredText;
    return this.#createHandle();
  }

  get active() {
    return (this[_queryStatus] & SQLQueryStatus.active) != 0;
  }

  set active(value) {
    const status = this[_queryStatus];
    if (status & (SQLQueryStatus.cancelled | SQLQueryStatus.error)) {
      return;
    }

    if (value) {
      this[_queryStatus] |= SQLQueryStatus.active;
    } else {
      this[_queryStatus] &= ~SQLQueryStatus.active;
    }
  }

  get cancelled() {
    return (this[_queryStatus] & SQLQueryStatus.cancelled) !== 0;
  }

  #settling() {
    this[_queryStatus] &= ~SQLQueryStatus.active;
    const settled = this[_settled];
    if (settled !== null && $isPromisePending(settled)) {
      $resolvePromise(settled, undefined);
    }
  }

  resolve(x: T) {
    this.#settling();
    if ($isPromisePending(this)) {
      this[_outcome] = x;
    }

    return this[_resolve](x);
  }

  reject(x: Error) {
    this[_queryStatus] |= SQLQueryStatus.error;
    this.#settling();
    if ($isPromisePending(this)) {
      this[_outcome] = x;
      this[_failed] = true;
    }

    return this[_reject](x);
  }

  /// Starts the query and blocks this thread until it has settled, or for `ms` milliseconds. The event loop does
  /// not turn meanwhile: the thread waits on the socket of the connection the query is on, and nothing else of
  /// the program runs. true: it has settled. false: the time passed. null: there is nothing for the thread to
  /// wait on, so only the event loop can settle it (every connection is in the hands of a caller that awaits,
  /// say), and waiting longer here would not help.
  wait(ms?: number): boolean | null {
    const adapter = this[_adapter] as {
      sweepSync?: () => void;
      waitSync?: (query: Query<T, Handle>, ms: number | undefined) => boolean | null;
      syncCallers?: number;
    };
    if (!(this[_queryStatus] & (SQLQueryStatus.executed | SQLQueryStatus.error))) {
      adapter.sweepSync?.();
    }
    // A dial that this call starts is one that this call waits for: see BaseSQLAdapter#syncCallers.
    const counted = adapter.syncCallers !== undefined;
    if (counted) {
      (adapter.syncCallers as number)++;
    }
    try {
      this.#run();
      // As with execute(): whoever waits this way reads the outcome from executeSync().
      $pokePromiseAsHandled(this);
      if ($isPromisePending(this)) {
        // A COPY stream is read or fed by code of this program, which runs on the thread that would block
        // here: the server waits for what the caller writes, or the caller for what its own reader takes.
        if (this[_flags] & SQLQueryFlags.copy) {
          return null;
        }
        const waited = adapter.waitSync ? adapter.waitSync(this, ms) : null;
        if ($isPromisePending(this)) {
          return waited === null ? null : false;
        }
      }
    } finally {
      if (counted) {
        (adapter.syncCallers as number)--;
      }
    }
    runSettled.$call(this);
    return true;
  }

  /// The result of the query, where it is called: wait(), then what the query resolved with, or a throw of what
  /// it rejected with. A query that has not settled after `ms` milliseconds keeps running, and can be awaited.
  executeSync(ms?: number): T {
    if (!this.wait(ms)) {
      const adapter = this[_adapter] as { error?: (code: string, message: string) => Error };
      const message = "The query has not settled, and executeSync() cannot wait for it any longer";
      throw adapter.error ? adapter.error("SYNC_TIMEOUT", message) : new Error(message);
    }
    if (this[_failed]) {
      throw this[_outcome];
    }
    return this[_outcome] as T;
  }

  cancel() {
    const status = this[_queryStatus];
    if (status & SQLQueryStatus.cancelled) {
      return this;
    }

    this[_queryStatus] |= SQLQueryStatus.cancelled;
    if (this[_flags] & SQLQueryFlags.copy) {
      this[_copy].abandon("Query cancelled");
    }

    const waiter = this[_waiter];
    const handle = this[_handle];
    if (waiter) {
      this[_waiter] = null;
      this[_adapter].cancelConnect(waiter);
      this.reject(this[_adapter].queryCancelledError());
    } else if (handle) {
      handle.cancel?.();
    } else if (status & SQLQueryStatus.executed) {
      // it waits for its text
      this.reject(this[_adapter].queryCancelledError());
    }

    return this;
  }

  /// cancel(), for a caller that does not yield: it then blocks until the request to stop the statement has
  /// reached the server, or for `ms` milliseconds. On PostgreSQL that request travels on a connection of its own.
  /// Left to the event loop it goes out after whatever the caller does next, which can be what the statement was
  /// waiting for: the statement then runs although it was cancelled.
  cancelSync(ms?: number) {
    const native = this[_pumped];
    this.cancel();
    if (native !== null) {
      (this[_adapter] as { cancelSync?: (native: unknown, ms: number | undefined) => void }).cancelSync?.(native, ms);
    }
    return this;
  }

  execute() {
    this.#run();
    return this;
  }

  /// then() rejects what these throw.
  #runTagged() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw this[_adapter].notTaggedCallError();
    }
    this.#run();
  }

  async run() {
    this.#runTagged();
    return this;
  }

  raw() {
    return this.#setMode(SQLQueryResultMode.raw);
  }

  simple() {
    this[_flags] |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    return this.#setMode(SQLQueryResultMode.values);
  }

  /// The server takes no parameters in a COPY, so nothing is lost with the simple protocol.
  #copyStream(writable: boolean) {
    const adapter = this[_adapter];
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw adapter.notTaggedCallError();
    }
    if (adapter.copyStream === undefined) {
      throw new Error("readable() and writable() are not supported by this adapter (PostgreSQL only)");
    }
    if (this[_queryStatus] & SQLQueryStatus.executed) {
      throw $ERR_INVALID_STATE("readable() and writable() must be called before the query starts");
    }
    this[_flags] |= SQLQueryFlags.simple | SQLQueryFlags.copy;
    return adapter.copyStream(this, writable);
  }

  readable() {
    return this.#copyStream(false) as ReadableStream<Uint8Array>;
  }

  writable() {
    return this.#copyStream(true) as WritableStream<string | ArrayBufferView | ArrayBufferLike>;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  then() {
    this.#run();

    return super.$then.$apply(this, arguments);
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult>;
  catch() {
    this.#runTagged();
    return super.catch.$apply(this, arguments);
  }

  finally(onFinally?: (() => void) | undefined | null) {
    this.#runTagged();
    if (!$isCallable(onFinally)) {
      return super.finally.$apply(this, arguments);
    }
    // Once `onFinally` and what it returned are through, the failure of the query passes on to `result`: as with
    // execute(), nobody has to handle it. What `onFinally` throws is the caller's own, and the mark is not reached.
    const result = super.finally(() => PublicPromise.$resolve(onFinally()).$then(() => $pokePromiseAsHandled(result)));
    return result;
  }
}

/// The callbacks of onQuerySettled(), once: in their microtask, or before it from wait().
function runSettled(this: Query<any, any>) {
  const callbacks = this[_onSettled];
  if (callbacks !== null) {
    this[_onSettled] = null;
    for (let i = 0; i < callbacks.length; i++) {
      callbacks[i]();
    }
  }
}

/// Calls `callback` in a microtask once the query has settled, before the reactions of the caller.
function onQuerySettled(query: Query<any, any>, callback: () => void) {
  // A query that is only started, sql`...`.execute(), does not end the process when it fails. What the caller makes
  // of it with then() or catch() is a promise like any other.
  $pokePromiseAsHandled(query);
  let settled = query[_settled];
  if (settled === null) {
    settled = query[_settled] = $newPromise<void>();
    if (!$isPromisePending(query)) {
      $resolvePromise(settled, undefined);
    }
    query[_onSettled] = [callback];
    settled.$then(runSettled.bind(query));
    return;
  }
  const callbacks = query[_onSettled];
  if (callbacks !== null) {
    callbacks.push(callback);
  } else {
    // They have run. As before: in a microtask of its own.
    settled.$then(callback);
  }
}

Object.defineProperty(Query, Symbol.species, { value: PublicPromise });
Object.defineProperty(Query, Symbol.toStringTag, { value: "Query" });

enum SQLQueryResultMode {
  objects = 0,
  values = 1,
  raw = 2,
}

enum SQLQueryFlags {
  none = 0,
  allowUnsafeTransaction = 1 << 0,
  unsafe = 1 << 1,
  bigint = 1 << 2,
  simple = 1 << 3,
  notTagged = 1 << 4,
  /// sent by begin() / savepoint() themselves: nothing that cancels a handle's queries cancels it
  internal = 1 << 5,
  /// the handler gets no handle: it finds the text (sql.file()) and calls setText()
  deferredText = 1 << 6,
  copy = 1 << 9,
}
/// Bits 7 and 8 of the flags: the SQLQueryResultMode asked for before the handle exists.
const resultModeShift = 7;

const enum SQLQueryStatus {
  none = 0,
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
}

export default {
  Query,
  onQuerySettled,
  SQLQueryFlags,
  SQLQueryResultMode,

  symbols: {
    _handle,
    _strings,
    _values,
    _flags,
    _results,
    _waiter,
    _copy,
    _pumped,
  },
};
