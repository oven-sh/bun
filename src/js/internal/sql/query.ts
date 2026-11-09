import type { DatabaseAdapter, SQLHelper } from "./shared.ts";

const _handle = Symbol("handle");
const _strings = Symbol("strings");
const _values = Symbol("values");
const _flags = Symbol("flags");
const _results = Symbol("results");
const _waiter = Symbol("waiter");
const _copy = Symbol("copy");

const PublicPromise = Promise;

export interface BaseQueryHandle<Connection> {
  cancel?(): void;
  setMode(mode: SQLQueryResultMode): void;
  run(connection: Connection, query: Query<any, any>): void | Promise<void>;
}

export type { Query, SQLQueryResultMode };
export type QueryStrings = string | TemplateStringsArray | SQLHelper<any> | Query<any, any>;

/// The query that `value` is, or that a Proxy of one wraps. Undefined for every other object: one that only inherits
/// from `Query.prototype` has the methods of a query and none of its state.
let queryOf: (value: object) => Query<any, any> | undefined;
/// Calls `callback` in a microtask once the query has settled, before the reactions of the caller.
let onQuerySettled: (query: Query<any, any>, callback: () => void) => void;
/// For "bun:internal-for-testing".
let adapterOf: (query: Query<any, any>) => DatabaseAdapter<any, any, any>;

class Query<T, Handle extends BaseQueryHandle<any>> extends PublicPromise<T> {
  // Private fields: what lists the own properties of a query, as `util.inspect()` with `customInspect: false` and a
  // failed `node:assert` do, then finds nothing that leads to the adapter and its connection options. The adapters
  // and the pool go through the accessors below.
  #resolve: (value: T) => void;
  #reject: (reason?: Error) => void;
  #handle: Handle | null = null;
  #handler: (query: Query<T, Handle>, handle: Handle | null) => unknown;
  #status: SQLQueryStatus = SQLQueryStatus.none;
  #strings: QueryStrings;
  #values: any[];
  #flags: SQLQueryFlags;
  #waiter: ((err: Error | null, connection: any) => void) | null = null;
  #settled: Promise<void> | null = null;
  #results: any = null;
  /// What is behind the stream of a query with SQLQueryFlags.copy. It is undefined in every other query.
  #copy!: { attach(handle: Handle): void; abandon(why: string): void };
  readonly #adapter: DatabaseAdapter<any, any, Handle>;

  static {
    queryOf = value => {
      if (!$isObject(value)) return undefined;
      while (!(#status in value)) {
        if (!$isProxyObject(value)) return undefined;
        value = $getProxyInternalField(value, $proxyFieldTarget);
        // a revoked Proxy
        if (value === null) return undefined;
      }
      return value;
    };
    onQuerySettled = (query, callback) => {
      // A query that is only started, sql`...`.execute(), does not end the process when it fails. What the caller
      // makes of it with then() or catch() is a promise like any other.
      $pokePromiseAsHandled(query);
      let settled = query.#settled;
      if (settled === null) {
        settled = query.#settled = $newPromise<void>();
        if (!$isPromisePending(query)) {
          $resolvePromise(settled, undefined);
        }
      }
      settled.$then(callback);
    };
    adapterOf = query => query.#adapter;
  }

  get [_handle]() {
    return this.#handle;
  }
  get [_strings]() {
    return this.#strings;
  }
  get [_values]() {
    return this.#values;
  }
  get [_flags]() {
    return this.#flags;
  }
  get [_results]() {
    return this.#results;
  }
  set [_results](results) {
    this.#results = results;
  }
  get [_waiter]() {
    return this.#waiter;
  }
  set [_waiter](waiter) {
    this.#waiter = waiter;
  }
  get [_copy]() {
    return this.#copy;
  }
  set [_copy](copy) {
    this.#copy = copy;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): `Query { ${string} }` {
    const receiver = queryOf(this);
    const status = receiver === undefined ? SQLQueryStatus.none : receiver.#status;

    let query = "";
    if ((status & SQLQueryStatus.active) != 0) query += "active ";
    if ((status & SQLQueryStatus.cancelled) != 0) query += "cancelled ";
    if ((status & SQLQueryStatus.executed) != 0) query += "executed ";
    if ((status & SQLQueryStatus.error) != 0) query += "error ";

    return `Query { ${query.trimEnd()} }`;
  }

  #createHandle(): Handle | null {
    try {
      const adapter = this.#adapter;
      const flags = this.#flags;
      const [sql, values] = adapter.normalizeQuery(this.#strings, this.#values);
      const handle = adapter.createQueryHandle(sql, values, flags);
      const mode = (flags >> resultModeShift) & 3;
      if (mode !== SQLQueryResultMode.objects) {
        handle.setMode(mode);
      }
      if (flags & SQLQueryFlags.copy) {
        this.#copy.attach(handle);
      }
      return (this.#handle = handle);
    } catch (err) {
      this.reject(err as Error);
      return null;
    }
  }

  #setMode(mode: SQLQueryResultMode) {
    this.#flags = (this.#flags & ~(3 << resultModeShift)) | (mode << resultModeShift);
    this.#handle?.setMode(mode);
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

    this.#adapter = adapter;

    if (typeof strings === "string" && !(flags & SQLQueryFlags.unsafe)) {
      // identifier (cannot be executed in safe mode); the adapter that runs the statement quotes it
      if (strings.includes("\0")) {
        throw $ERR_INVALID_ARG_VALUE("name", strings, "must not contain null bytes");
      }
      flags |= SQLQueryFlags.notTagged;
    }

    this.#resolve = resolve_!;
    this.#reject = reject_!;
    this.#handler = handler;
    this.#strings = strings;
    this.#values = values;
    this.#flags = flags;
  }

  #run() {
    const handler = this.#handler;
    const status = this.#status;
    const flags = this.#flags;

    if (status & (SQLQueryStatus.executed | SQLQueryStatus.error)) {
      return;
    }

    if (flags & SQLQueryFlags.notTagged) {
      this.reject(this.#adapter.notTaggedCallError());
      return;
    }

    if (status & SQLQueryStatus.cancelled) {
      // as in onQuerySettled()
      $pokePromiseAsHandled(this);
      this.reject(this.#adapter.queryCancelledError());
      return;
    }

    this.#status |= SQLQueryStatus.executed;
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
    if (this.#status & SQLQueryStatus.error) {
      return null;
    }
    this.#strings = text;
    this.#flags &= ~SQLQueryFlags.deferredText;
    return this.#createHandle();
  }

  get active() {
    const query = queryOf(this);
    return query !== undefined && (query.#status & SQLQueryStatus.active) != 0;
  }

  set active(value) {
    const query = queryOf(this);
    if (query === undefined || query.#status & (SQLQueryStatus.cancelled | SQLQueryStatus.error)) {
      return;
    }

    if (value) {
      query.#status |= SQLQueryStatus.active;
    } else {
      query.#status &= ~SQLQueryStatus.active;
    }
  }

  get cancelled() {
    const query = queryOf(this);
    return query !== undefined && (query.#status & SQLQueryStatus.cancelled) !== 0;
  }

  #settling() {
    this.#status &= ~SQLQueryStatus.active;
    const settled = this.#settled;
    if (settled !== null && $isPromisePending(settled)) {
      $resolvePromise(settled, undefined);
    }
  }

  resolve(x: T) {
    this.#settling();

    return this.#resolve(x);
  }

  reject(x: Error) {
    this.#status |= SQLQueryStatus.error;
    this.#settling();

    return this.#reject(x);
  }

  #cancel() {
    const status = this.#status;
    if (status & SQLQueryStatus.cancelled) {
      return;
    }

    this.#status |= SQLQueryStatus.cancelled;
    if (this.#flags & SQLQueryFlags.copy) {
      this.#copy.abandon("Query cancelled");
    }

    const waiter = this.#waiter;
    const handle = this.#handle;
    if (waiter) {
      this.#waiter = null;
      this.#adapter.cancelConnect(waiter);
      this.reject(this.#adapter.queryCancelledError());
    } else if (handle) {
      handle.cancel?.();
    } else if (status & SQLQueryStatus.executed) {
      // it waits for its text
      this.reject(this.#adapter.queryCancelledError());
    }
  }

  cancel() {
    const query = queryOf(this);
    if (query !== undefined) {
      query.#cancel();
    }
    return this;
  }

  execute() {
    this.#run();
    return this;
  }

  /// then() rejects what these throw.
  #runTagged() {
    if (this.#flags & SQLQueryFlags.notTagged) {
      throw this.#adapter.notTaggedCallError();
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
    const query = queryOf(this);
    if (query !== undefined) {
      query.#flags |= SQLQueryFlags.simple;
    }
    return this;
  }

  values() {
    return this.#setMode(SQLQueryResultMode.values);
  }

  /// The server takes no parameters in a COPY, so nothing is lost with the simple protocol.
  #copyStream(writable: boolean) {
    const adapter = this.#adapter;
    if (this.#flags & SQLQueryFlags.notTagged) {
      throw adapter.notTaggedCallError();
    }
    if (adapter.copyStream === undefined) {
      throw new Error("readable() and writable() are not supported by this adapter (PostgreSQL only)");
    }
    if (this.#status & SQLQueryStatus.executed) {
      throw $ERR_INVALID_STATE("readable() and writable() must be called before the query starts");
    }
    this.#flags |= SQLQueryFlags.simple | SQLQueryFlags.copy;
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
  queryOf,
  onQuerySettled,
  adapterOf,
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
