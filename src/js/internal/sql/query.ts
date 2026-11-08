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

    return this[_resolve](x);
  }

  reject(x: Error) {
    this[_queryStatus] |= SQLQueryStatus.error;
    this.#settling();

    return this[_reject](x);
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
  }
  settled.$then(callback);
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
  },
};
