import type { SQLHelper } from "./shared.ts";
const { escapeIdentifier, notTaggedCallError } = require("internal/sql/utils");

const _resolve = Symbol("resolve");
const _reject = Symbol("reject");
const _handle = Symbol("handle");
const _run = Symbol("run");
const _queryStatus = Symbol("status");
const _handler = Symbol("handler");
const _strings = Symbol("strings");
const _values = Symbol("values");
const _poolSize = Symbol("poolSize");
const _flags = Symbol("flags");
const _results = Symbol("results");

const PublicPromise = Promise;

export interface BaseQueryHandle {
  done(): void;
  cancel(): void;
  setMode(mode: SQLQueryResultMode): void;
}

export type { Query };
class Query<T, Handle extends BaseQueryHandle> extends PublicPromise<T> {
  public [_resolve]: (value: T) => void;
  public [_reject]: (reason?: any) => void;
  public [_handle]: Handle | null;
  public [_handler]: (query: Query<T, Handle>, handle: Handle) => T;
  public [_queryStatus] = 0;
  public [_strings]: string | TemplateStringsArray | SQLHelper<any> | Query<any, Handle>;
  public [_values]: any[];

  [Symbol.for("nodejs.util.inspect.custom")](): `Query { ${string} }` {
    const status = this[_queryStatus];

    let query = "";
    if ((status & QueryStatus.active) != 0) query += "active ";
    if ((status & QueryStatus.cancelled) != 0) query += "cancelled ";
    if ((status & QueryStatus.executed) != 0) query += "executed ";
    if ((status & QueryStatus.error) != 0) query += "error ";

    return `Query { ${query} }`;
  }

  // TODO(@alii): Make Query more generic for SQLite
  private readonly doCreateQuery: Function;

  private getQueryHandle() {
    let handle = this[_handle];

    if (!handle) {
      try {
        this[_handle] = handle = this.doCreateQuery(
          this[_strings],
          this[_values],
          this[_flags] & SQLQueryFlags.allowUnsafeTransaction,
          this[_poolSize],
          this[_flags] & SQLQueryFlags.bigint,
          this[_flags] & SQLQueryFlags.simple,
        );
      } catch (err) {
        this[_queryStatus] |= QueryStatus.error | QueryStatus.invalidHandle;
        this.reject(err);
      }
    }

    return handle;
  }

  constructor(
    strings: string | TemplateStringsArray | SQLHelper<any> | Query<any, Handle>,
    values: any[],
    flags: number,
    poolSize: number,
    handler,
    doCreateQuery: Function,
  ) {
    let resolve_: (value: T) => void, reject_: (reason?: any) => void;

    super((resolve, reject) => {
      resolve_ = resolve;
      reject_ = reject;
    });

    this.doCreateQuery = doCreateQuery;

    if (typeof strings === "string") {
      if (!(flags & SQLQueryFlags.unsafe)) {
        // identifier (cannot be executed in safe mode)
        flags |= SQLQueryFlags.notTagged;
        strings = escapeIdentifier(strings);
      }
    }

    this[_resolve] = resolve_!;
    this[_reject] = reject_!;
    this[_handle] = null;
    this[_handler] = handler;
    this[_queryStatus] = 0;
    this[_poolSize] = poolSize;
    this[_strings] = strings;
    this[_values] = values;
    this[_flags] = flags;

    this[_results] = null;
  }

  async [_run](async: boolean) {
    const { [_handler]: handler, [_queryStatus]: status } = this;

    if (status & (QueryStatus.executed | QueryStatus.error | QueryStatus.cancelled | QueryStatus.invalidHandle)) {
      return;
    }
    if (this[_flags] & SQLQueryFlags.notTagged) {
      this.reject(notTaggedCallError());
      return;
    }
    this[_queryStatus] |= QueryStatus.executed;
    const handle = this.getQueryHandle();
    if (!handle) return this;

    if (async) {
      // Ensure it's actually async
      // eslint-disable-next-line
      await 1;
    }

    try {
      return handler(this, handle);
    } catch (err) {
      this[_queryStatus] |= QueryStatus.error;
      this.reject(err);
    }
  }
  get active() {
    return (this[_queryStatus] & QueryStatus.active) != 0;
  }

  set active(value) {
    const status = this[_queryStatus];
    if (status & (QueryStatus.cancelled | QueryStatus.error)) {
      return;
    }

    if (value) {
      this[_queryStatus] |= QueryStatus.active;
    } else {
      this[_queryStatus] &= ~QueryStatus.active;
    }
  }

  get cancelled() {
    return (this[_queryStatus] & QueryStatus.cancelled) !== 0;
  }

  resolve(x) {
    this[_queryStatus] &= ~QueryStatus.active;
    const handle = this.getQueryHandle();
    if (!handle) return this;
    handle.done();
    return this[_resolve](x);
  }

  reject(x: Error) {
    this[_queryStatus] &= ~QueryStatus.active;
    this[_queryStatus] |= QueryStatus.error;
    if (!(this[_queryStatus] & QueryStatus.invalidHandle)) {
      const handle = this.getQueryHandle();
      if (!handle) return this[_reject](x);
      handle.done();
    }

    return this[_reject](x);
  }

  cancel() {
    const status = this[_queryStatus];
    if (status & QueryStatus.cancelled) {
      return this;
    }
    this[_queryStatus] |= QueryStatus.cancelled;

    if (status & QueryStatus.executed) {
      const handle = this.getQueryHandle();

      if (handle) {
        handle.cancel();
      }
    }

    return this;
  }

  execute() {
    this[_run](false);
    return this;
  }

  raw() {
    const handle = this.getQueryHandle();
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.raw);
    return this;
  }

  simple() {
    this[_flags] |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    const handle = this.getQueryHandle();
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.values);
    return this;
  }

  then() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.$then.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  catch() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.catch.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  finally(_onfinally?: (() => void) | undefined | null) {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
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

enum QueryStatus {
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
  invalidHandle = 1 << 5,
}

export default {
  Query,
  SQLQueryFlags,
  SQLQueryResultMode,
  QueryStatus,

  symbols: {
    _resolve,
    _reject,
    _handle,
    _run,
    _queryStatus,
    _handler,
    _strings,
    _values,
    _poolSize,
    _flags,
    _results,
  },
};
