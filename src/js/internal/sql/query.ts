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
const _nextStarted = Symbol("nextStarted");
const _previousStarted = Symbol("previousStarted");

const PublicPromise = Promise;

/// Gives the started queries of `adapter` to it now, in start order. A close() that waits calls this right before it
/// stops taking queries, so that a query which started before close() does not find the pool closed.
/// A query stays in the list after this. Its own start takes it out, and then does nothing more.
function handOffStartedQueries(adapter: DatabaseAdapter<any, any, any>) {
  for (let query = adapter.firstStarted; query !== undefined; query = query[_nextStarted]) {
    if (query[_queryStatus] & SQLQueryStatus.handedOff) {
      continue;
    }
    query[_queryStatus] |= SQLQueryStatus.handedOff;
    try {
      query[_handler](query, query[_handle]!);
    } catch (err) {
      query[_queryStatus] |= SQLQueryStatus.error;
      query.reject(err as Error);
    }
  }
}

export interface BaseQueryHandle<Connection> {
  done?(): void;
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
  public [_handler]: (query: Query<T, Handle>, handle: Handle) => T;
  public [_queryStatus]: SQLQueryStatus;
  public [_strings]: QueryStrings;
  public [_values]: any[];
  public [_flags]: SQLQueryFlags;
  public [_nextStarted]: Query<any, any> | undefined;
  public [_previousStarted]: Query<any, any> | undefined;

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

  #getQueryHandle() {
    let handle = this[_handle];

    if (!handle) {
      try {
        const [sql, values] = this[_adapter].normalizeQuery(this[_strings], this[_values]);
        this[_handle] = handle = this[_adapter].createQueryHandle(sql, values, this[_flags]);
      } catch (err) {
        this[_queryStatus] |= SQLQueryStatus.error | SQLQueryStatus.invalidHandle;
        this.reject(err as Error);
      }
    }

    return handle;
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

    if (typeof strings === "string") {
      if (!(flags & SQLQueryFlags.unsafe)) {
        // identifier (cannot be executed in safe mode)
        flags |= SQLQueryFlags.notTagged;
        strings = adapter.escapeIdentifier(strings);
      }
    }

    this[_resolve] = resolve_!;
    this[_reject] = reject_!;
    this[_handle] = null;
    this[_handler] = handler;
    this[_queryStatus] = SQLQueryStatus.none;
    this[_strings] = strings;
    this[_values] = values;
    this[_flags] = flags;

    this[_results] = null;
  }

  #run() {
    const { [_handler]: handler, [_queryStatus]: status } = this;

    if (
      status &
      (SQLQueryStatus.executed | SQLQueryStatus.error | SQLQueryStatus.cancelled | SQLQueryStatus.invalidHandle)
    ) {
      return;
    }

    if (this[_flags] & SQLQueryFlags.notTagged) {
      this.reject(this[_adapter].notTaggedCallError());
      return;
    }

    this[_queryStatus] |= SQLQueryStatus.executed;
    const handle = this.#getQueryHandle();

    if (!handle) {
      return this;
    }

    try {
      return handler(this, handle);
    } catch (err) {
      this[_queryStatus] |= SQLQueryStatus.error;
      this.reject(err as Error);
    }
  }

  async #runAsync() {
    const { [_handler]: handler, [_queryStatus]: status } = this;

    if (
      status &
      (SQLQueryStatus.executed | SQLQueryStatus.error | SQLQueryStatus.cancelled | SQLQueryStatus.invalidHandle)
    ) {
      return;
    }

    if (this[_flags] & SQLQueryFlags.notTagged) {
      this.reject(this[_adapter].notTaggedCallError());
      return;
    }

    this[_queryStatus] |= SQLQueryStatus.executed;
    const handle = this.#getQueryHandle();

    if (!handle) {
      return this;
    }

    // A query of a transaction or of a reserved connection runs on that connection, not through the pool.
    const adapter = this[_flags] & SQLQueryFlags.allowUnsafeTransaction ? undefined : this[_adapter];
    if (adapter !== undefined) {
      const previous = adapter.lastStarted;
      if (previous === undefined) {
        adapter.firstStarted = this;
      } else {
        previous[_nextStarted] = this;
        this[_previousStarted] = previous;
      }
      adapter.lastStarted = this;
    }

    // Not a promise: to await a promise reads its `constructor`, and code of the caller can run there.
    await undefined;

    if (adapter !== undefined) {
      const previous = this[_previousStarted];
      const next = this[_nextStarted];
      if (previous === undefined) {
        adapter.firstStarted = next;
      } else {
        previous[_nextStarted] = next;
        this[_previousStarted] = undefined;
      }
      if (next === undefined) {
        adapter.lastStarted = previous;
      } else {
        next[_previousStarted] = previous;
        this[_nextStarted] = undefined;
      }
      if (this[_queryStatus] & SQLQueryStatus.handedOff) {
        return;
      }
    }

    try {
      return handler(this, handle);
    } catch (err) {
      this[_queryStatus] |= SQLQueryStatus.error;
      this.reject(err as Error);
    }
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

  resolve(x: T) {
    this[_queryStatus] &= ~SQLQueryStatus.active;
    const handle = this.#getQueryHandle();

    if (!handle) {
      return this;
    }

    handle.done?.();

    return this[_resolve](x);
  }

  reject(x: Error) {
    this[_queryStatus] &= ~SQLQueryStatus.active;
    this[_queryStatus] |= SQLQueryStatus.error;

    if (!(this[_queryStatus] & SQLQueryStatus.invalidHandle)) {
      const handle = this.#getQueryHandle();

      if (!handle) {
        return this[_reject](x);
      }

      handle.done?.();
    }

    return this[_reject](x);
  }

  cancel() {
    const status = this[_queryStatus];
    if (status & SQLQueryStatus.cancelled) {
      return this;
    }

    this[_queryStatus] |= SQLQueryStatus.cancelled;

    if (status & SQLQueryStatus.executed) {
      const handle = this.#getQueryHandle();

      if (handle) {
        handle.cancel?.();
      }
    }

    return this;
  }

  execute() {
    this.#run();
    return this;
  }

  async run() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw this[_adapter].notTaggedCallError();
    }

    await this.#runAsync();
    return this;
  }

  raw() {
    const handle = this.#getQueryHandle();

    if (!handle) {
      return this;
    }

    handle.setMode(SQLQueryResultMode.raw);
    return this;
  }

  simple() {
    this[_flags] |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    const handle = this.#getQueryHandle();

    if (!handle) {
      return this;
    }

    handle.setMode(SQLQueryResultMode.values);
    return this;
  }

  #runAsyncAndCatch() {
    const runPromise = this.#runAsync();

    if ($isPromise(runPromise) && runPromise !== this) {
      runPromise.catch(() => {
        // Error is already handled via this.reject() in #runAsync
        // This catch is just to prevent unhandled rejection warnings
      });
    }
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  then() {
    this.#runAsyncAndCatch();

    const result = super.$then.$apply(this, arguments);

    // Only mark as handled if there's a rejection handler
    const hasRejectionHandler = arguments.length >= 2 && arguments[1] != null;
    if (hasRejectionHandler) {
      $pokePromiseAsHandled(result);
    }

    return result;
  }

  catch() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw this[_adapter].notTaggedCallError();
    }

    this.#runAsyncAndCatch();

    const result = super.catch.$apply(this, arguments);
    $pokePromiseAsHandled(result);

    return result;
  }

  finally(_onfinally?: (() => void) | undefined | null) {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw this[_adapter].notTaggedCallError();
    }

    this.#runAsyncAndCatch();

    return super.finally.$apply(this, arguments);
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
}

const enum SQLQueryStatus {
  none = 0,
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
  invalidHandle = 1 << 5,
  /// close() gave the query to the pool before the start of the query did.
  handedOff = 1 << 6,
}

export default {
  Query,
  handOffStartedQueries,
  SQLQueryFlags,
  SQLQueryResultMode,

  symbols: {
    _handle,
    _strings,
    _values,
    _results,
  },
};
