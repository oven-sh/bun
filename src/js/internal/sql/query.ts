// @ts-check
import type { DatabaseAdapter, SQLHelper } from "./shared.ts";

const _state = Symbol("state");

const PublicPromise = Promise;

function noop() {}

export interface BaseQueryHandle<Connection> {
  cancel?(): void;
  setMode(mode: SQLQueryResultMode): void;
  run(connection: Connection, query: Query<any, any>): void | Promise<void>;
}

export type { Query, QueryState, SQLQueryResultMode };
export type QueryStrings = string | TemplateStringsArray | SQLHelper<any> | Query<any, any>;

/// What is behind the stream of a query with SQLQueryFlags.copy.
interface CopyStream<Handle> {
  attach(handle: Handle): void;
  abandon(why: string): void;
}

class QueryState<T, Handle extends BaseQueryHandle<any>> {
  readonly query: Query<T, Handle>;
  readonly adapter: DatabaseAdapter<any, any, any>;
  handler: (query: Query<T, Handle>, handle: any) => unknown;
  strings: QueryStrings;
  values: any[];
  flags: number;
  status: number = SQLQueryStatus.none;
  handle: any = null;
  waiter: ((err: Error | null, connection: any) => void) | null = null;
  settled: Promise<void> | null = null;
  results: unknown = null;
  copy: CopyStream<any> | null = null;

  constructor(
    query: Query<T, Handle>,
    strings: QueryStrings,
    values: any[],
    flags: number,
    handler: (query: Query<T, Handle>, handle: any) => unknown,
    adapter: DatabaseAdapter<any, any, any>,
  ) {
    this.query = query;
    this.adapter = adapter;
    this.handler = handler;
    this.strings = strings;
    this.values = values;
    this.flags = flags;
  }

  static attach(target: object, handle: any) {
    const state = new QueryState<void, any>(target as Query<void, any>, "", [], SQLQueryFlags.none, noop, null as never);
    state.handle = handle;
    (target as { [_state]: QueryState<void, any> })[_state] = state;
  }

  createHandle(): any {
    try {
      const adapter = this.adapter;
      const flags = this.flags;
      const [sql, values] = adapter.normalizeQuery(this.strings, this.values);
      const handle = adapter.createQueryHandle(sql, values, flags);
      const mode = (flags >> resultModeShift) & 3;
      if (mode !== SQLQueryResultMode.objects) {
        handle.setMode(mode);
      }
      if (flags & SQLQueryFlags.copy) {
        this.copy!.attach(handle);
      }
      return (this.handle = handle);
    } catch (err) {
      this.reject(err as Error);
      return null;
    }
  }

  setMode(mode: SQLQueryResultMode) {
    this.flags = (this.flags & ~(3 << resultModeShift)) | (mode << resultModeShift);
    this.handle?.setMode(mode);
  }

  run() {
    const status = this.status;
    const flags = this.flags;

    if (status & (SQLQueryStatus.executed | SQLQueryStatus.error)) {
      return;
    }

    if (flags & SQLQueryFlags.notTagged) {
      this.reject(this.adapter.notTaggedCallError());
      return;
    }

    if (status & SQLQueryStatus.cancelled) {
      this.reject(this.adapter.queryCancelledError());
      return;
    }

    this.status = status | SQLQueryStatus.executed;
    let handle: any = null;
    if (!(flags & SQLQueryFlags.deferredText)) {
      handle = this.createHandle();
      if (handle === null) {
        return;
      }
    }

    try {
      this.handler(this.query, handle);
    } catch (err) {
      this.reject(err as Error);
    }
  }

  /// then() rejects what this throws.
  runTagged() {
    if (this.flags & SQLQueryFlags.notTagged) {
      throw this.adapter.notTaggedCallError();
    }
    this.run();
  }

  settling() {
    this.status &= ~SQLQueryStatus.active;
    const settled = this.settled;
    if (settled !== null && $isPromisePending(settled)) {
      $resolvePromise(settled, undefined);
    }
  }

  resolve(x: T) {
    this.settling();
    $resolvePromiseWithFirstResolvingFunctionCallCheck(this.query, x);
  }

  reject(x: Error) {
    this.status |= SQLQueryStatus.error;
    this.settling();
    $rejectPromiseWithFirstResolvingFunctionCallCheck(this.query, x);
  }
}

class Query<T, Handle extends BaseQueryHandle<any>> extends PublicPromise<T> {
  declare public readonly [_state]: QueryState<T, Handle>;

  [Symbol.for("nodejs.util.inspect.custom")](): `Query { ${string} }` {
    const status = this[_state].status;

    let query = "";
    if ((status & SQLQueryStatus.active) != 0) query += "active ";
    if ((status & SQLQueryStatus.cancelled) != 0) query += "cancelled ";
    if ((status & SQLQueryStatus.executed) != 0) query += "executed ";
    if ((status & SQLQueryStatus.error) != 0) query += "error ";

    return `Query { ${query.trimEnd()} }`;
  }

  constructor(
    strings: QueryStrings,
    values: any[],
    flags: number,
    handler: (query: Query<T, Handle>, handle: any) => unknown,
    adapter: DatabaseAdapter<any, any, any>,
  ) {
    super(noop);

    if (typeof strings === "string" && !(flags & SQLQueryFlags.unsafe)) {
      // identifier (cannot be executed in safe mode); the adapter that runs the statement quotes it
      if (strings.includes("\0")) {
        throw $ERR_INVALID_ARG_VALUE("name", strings, "must not contain null bytes");
      }
      flags |= SQLQueryFlags.notTagged;
    }

    this[_state] = new QueryState<T, Handle>(this, strings, values, flags, handler, adapter);
  }

  setText(text: string): any {
    const state = this[_state];
    if (state.status & SQLQueryStatus.error) {
      return null;
    }
    state.strings = text;
    state.flags &= ~SQLQueryFlags.deferredText;
    return state.createHandle();
  }

  get active() {
    return (this[_state].status & SQLQueryStatus.active) != 0;
  }

  set active(value) {
    const state = this[_state];
    const status = state.status;
    if (status & (SQLQueryStatus.cancelled | SQLQueryStatus.error)) {
      return;
    }

    if (value) {
      state.status = status | SQLQueryStatus.active;
    } else {
      state.status = status & ~SQLQueryStatus.active;
    }
  }

  get cancelled() {
    return (this[_state].status & SQLQueryStatus.cancelled) !== 0;
  }

  resolve(x: T) {
    this[_state].resolve(x);
  }

  reject(x: Error) {
    this[_state].reject(x);
  }

  cancel() {
    const state = this[_state];
    const status = state.status;
    if (status & SQLQueryStatus.cancelled) {
      return this;
    }

    state.status = status | SQLQueryStatus.cancelled;
    if (state.flags & SQLQueryFlags.copy) {
      state.copy!.abandon("Query cancelled");
    }

    const waiter = state.waiter;
    const handle = state.handle;
    if (waiter) {
      state.waiter = null;
      state.adapter.cancelConnect(waiter);
      state.reject(state.adapter.queryCancelledError());
    } else if (handle) {
      handle.cancel?.();
    } else if (status & SQLQueryStatus.executed) {
      // it waits for its text
      state.reject(state.adapter.queryCancelledError());
    }

    return this;
  }

  execute() {
    this[_state].run();
    return this;
  }

  async run() {
    this[_state].runTagged();
    return this;
  }

  raw() {
    this[_state].setMode(SQLQueryResultMode.raw);
    return this;
  }

  simple() {
    this[_state].flags |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    this[_state].setMode(SQLQueryResultMode.values);
    return this;
  }

  /// The server takes no parameters in a COPY, so nothing is lost with the simple protocol.
  #copyStream(writable: boolean) {
    const state = this[_state];
    const adapter = state.adapter;
    if (state.flags & SQLQueryFlags.notTagged) {
      throw adapter.notTaggedCallError();
    }
    if (adapter.copyStream === undefined) {
      throw new Error("readable() and writable() are not supported by this adapter (PostgreSQL only)");
    }
    if (state.status & SQLQueryStatus.executed) {
      throw $ERR_INVALID_STATE("readable() and writable() must be called before the query starts");
    }
    state.flags |= SQLQueryFlags.simple | SQLQueryFlags.copy;
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
    this[_state].run();

    return PublicPromise.prototype.$then.$apply(this, arguments);
  }

  catch() {
    this[_state].runTagged();
    return super.catch.$apply(this, arguments);
  }

  finally(onFinally?: (() => void) | undefined | null) {
    this[_state].runTagged();
    if (!$isCallable(onFinally)) {
      return super.finally.$apply(this, arguments);
    }
    // Once `onFinally` and what it returned are through, the failure of the query passes on to `result`: as with
    // execute(), nobody has to handle it. What `onFinally` throws is the caller's own, and the mark is not reached.
    const result = super.finally(() => PublicPromise.$resolve(onFinally()).$then(() => $pokePromiseAsHandled(result)));
    return result;
  }
}

function stateOf<T, Handle extends BaseQueryHandle<any>>(query: Query<T, Handle>): QueryState<T, Handle> {
  return query[_state];
}

/// Calls `callback` in a microtask once the query has settled, before the reactions of the caller.
function onQuerySettled(query: Query<any, any>, callback: () => void) {
  // A query that is only started, sql`...`.execute(), does not end the process when it fails. What the caller makes
  // of it with then() or catch() is a promise like any other.
  $pokePromiseAsHandled(query);
  const state = query[_state];
  let settled = state.settled;
  if (settled === null) {
    settled = state.settled = $newPromise<void>();
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
  QueryState,
  stateOf,
  onQuerySettled,
  SQLQueryFlags,
  SQLQueryResultMode,
};
