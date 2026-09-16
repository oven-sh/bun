declare module "bun" {
  /**
   * A Durable Object: a class instance with an id, storage of its own and one
   * thread of execution. Every id has at most one instance; calls to it arrive
   * through a {@link DurableObjectStub} and are delivered one event at a time.
   *
   * Extend this class and give it to a {@link DurableObjectNamespace}. Public
   * methods of the class are callable through the stub. `fetch()`, `alarm()`
   * and the `webSocket*()` handlers are called by the runtime.
   *
   * @experimental
   * @example
   * ```ts
   * class Counter extends Bun.DurableObject {
   *   increment(by = 1) {
   *     const next = (this.ctx.storage.kv.get<number>("count") ?? 0) + by;
   *     this.ctx.storage.kv.put("count", next);
   *     return next;
   *   }
   * }
   *
   * const counters = new Bun.DurableObjectNamespace({ class: Counter, storage: "./data" });
   * await counters.getByName("visits").increment(); // 1
   * ```
   */
  abstract class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
    protected ctx: DurableObjectState;
    protected env: Env;

    /**
     * Pass as `websocket` to {@link serve} so that a Durable Object can
     * `server.upgrade()` the requests it is given. Sockets that no Durable
     * Object accepted are ignored by it.
     */
    static readonly websocket: WebSocketHandler<unknown>;
  }

  /**
   * The methods of a {@link DurableObject} class that the runtime calls. All
   * are optional; `implements Bun.DurableObjectHandlers` checks their shapes.
   */
  interface DurableObjectHandlers {
    /** `stub.fetch(request, server?)`. Return nothing after `server.upgrade(request)`. */
    fetch?(request: Request, server?: DurableObjectServer): Response | undefined | Promise<Response | undefined>;
    /** Called when the time set with `ctx.storage.setAlarm()` comes. Called again, with backoff, when it throws. */
    alarm?(info: DurableObjectAlarmInfo): void | Promise<void>;
    webSocketOpen?(ws: ServerWebSocket<any>): void | Promise<void>;
    webSocketMessage?(ws: ServerWebSocket<any>, message: string | Buffer): void | Promise<void>;
    webSocketClose?(ws: ServerWebSocket<any>, code: number, reason: string, wasClean: boolean): void | Promise<void>;
    webSocketDrain?(ws: ServerWebSocket<any>): void | Promise<void>;
  }

  interface DurableObjectAlarmInfo {
    readonly isRetry: boolean;
    readonly retryCount: number;
    /** When the alarm was set for, in milliseconds since the epoch. */
    readonly scheduledTime: number;
  }

  interface DurableObjectNamespaceCommonOptions {
    /**
     * Identifies the namespace: ids are derived from it and storage is kept
     * under it. Defaults to the class's name.
     */
    name?: string | undefined;
    /**
     * Directory to keep the objects' SQLite databases in. One namespace, in
     * one process, uses a directory at a time. Without it, storage is in
     * memory and lasts as long as the namespace.
     */
    storage?: string | undefined;
    /** Passed to every object's constructor. */
    env?: unknown;
    /**
     * An object that has had nothing to do for this many milliseconds (at most
     * twice that) is evicted from memory; its storage, alarm and WebSockets
     * stay. `0` evicts an object as soon as it is idle. Default `10_000`.
     */
    idleTimeout?: number | undefined;
    /**
     * Errors nobody is waiting for: an `alarm()` or `webSocket*()` handler
     * that throws, a rejected `waitUntil()` promise, an object that cannot be
     * started for an alarm or a WebSocket message, and uncaught errors of an
     * object's own timers and I/O. Without it they are uncaught exceptions of
     * the process.
     */
    onError?: ((error: unknown, id: DurableObjectId) => void) | undefined;
  }

  type DurableObjectNamespaceOptions<T extends object = object> = DurableObjectNamespaceCommonOptions &
    (
      | {
          /**
           * The class of the objects. Every object runs in a context of its own
           * for timers and I/O (see {@link ModuleGraph}); module state is shared,
           * as it is between instances of any class.
           */
          class: new (ctx: DurableObjectState, env: any) => T;
          module?: never;
          export?: never;
          globals?: never;
        }
      | {
          class?: never;
          /**
           * Instead of `class`: a module that exports the class, resolved like an
           * `import()` from the working directory. Every object loads the module
           * into a {@link ModuleGraph} of its own, so module-level state is per
           * object too. Compiled code is shared.
           */
          module: string;
          /** The export of `module` that is the class. Default `"default"`. */
          export?: string | undefined;
          /** Values for free identifiers in `module`'s code, as they are now; see {@link ModuleGraphOptions.globals}. */
          globals?: Record<string, unknown> | undefined;
        }
    );

  /**
   * The objects of one Durable Object class.
   *
   * @experimental
   */
  class DurableObjectNamespace<T extends object = DurableObject> {
    constructor(options: DurableObjectNamespaceOptions<T>);
    /** The id of the object with this name. The same name is always the same id. */
    idFromName(name: string): DurableObjectId;
    /** A new random id. */
    newUniqueId(): DurableObjectId;
    /** An id back from `id.toString()`. Throws for a string that is not an id of this namespace. */
    idFromString(id: string): DurableObjectId;
    /** A stub for the object with this id. The object is started by the first call made through a stub. */
    get(id: DurableObjectId): DurableObjectStub<T>;
    /** `get(idFromName(name))` */
    getByName(name: string): DurableObjectStub<T>;
    /**
     * Waits for the events that are running to finish, evicts every object,
     * closes their WebSockets and the storage. Calls made from now on fail.
     */
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  }

  interface DurableObjectId {
    /** 64 hex digits. */
    toString(): string;
    equals(other: DurableObjectId): boolean;
    /** The name, for an id made by `idFromName()` / `getByName()`. */
    readonly name?: string;
  }

  type DurableObjectReservedMethod =
    | "id"
    | "name"
    | "fetch"
    | "then"
    | "constructor"
    | "toJSON"
    | "alarm"
    | "webSocketOpen"
    | "webSocketMessage"
    | "webSocketClose"
    | "webSocketError"
    | "webSocketDrain"
    | "ctx"
    | "env";

  /**
   * Calls a Durable Object. Every public method of the class is a method of
   * the stub that returns a promise, and `await stub.property` reads a getter.
   * Arguments and results are passed as they are, not copied.
   *
   * A call fails with `ERR_DURABLE_OBJECT_RESET` when the object is reset
   * (`ctx.abort()`, a failed `blockConcurrencyWhile()`) before it finishes.
   */
  type DurableObjectStub<T extends object = DurableObject> = {
    readonly id: DurableObjectId;
    readonly name?: string;
    /** Calls the object's `fetch(request, server)`. Pass the `server` for the object to be able to `server.upgrade()` the request. */
    fetch(request: Request, server?: Server<any>): Promise<Response | undefined>;
    fetch(input: string | URL | Request, init?: RequestInit, server?: Server<any>): Promise<Response | undefined>;
  } & {
    [K in Exclude<keyof T, DurableObjectReservedMethod>]: T[K] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : Promise<Awaited<T[K]>>;
  };

  /** `ctx` */
  interface DurableObjectState {
    readonly id: DurableObjectId;
    readonly storage: DurableObjectStorage;
    /** Keeps the object in memory until the promise settles. */
    waitUntil(promise: Promise<unknown>): void;
    /**
     * No other event is started until the callback's promise settles (one that
     * was already waiting on I/O resumes when that completes). If it rejects,
     * or takes more than 30 seconds, the object is reset. In a constructor:
     * nothing is delivered until the object has initialized.
     */
    blockConcurrencyWhile<T>(callback: () => T | Promise<T>): Promise<T>;
    /**
     * Resets the object: every call in progress fails, what was written and not
     * yet committed is rolled back, everything the object opened is closed. The
     * next call starts a new instance. Throws.
     */
    abort(reason?: string | Error): never;
    /**
     * Makes an open `ServerWebSocket` this object's. Its events come to the
     * `webSocket*()` handlers, and it stays connected while the object is
     * evicted. The server must have been given `Bun.DurableObject.websocket`.
     */
    acceptWebSocket(ws: ServerWebSocket<any>, tags?: string[]): void;
    /** The open WebSockets of this object, optionally only those accepted with `tag`. */
    getWebSockets(tag?: string): ServerWebSocket<any>[];
    getTags(ws: ServerWebSocket<any>): string[];
    /** A message equal to `request` is answered with `response` without waking the object. */
    setWebSocketAutoResponse(pair?: { request: string; response: string } | null): void;
    getWebSocketAutoResponse(): { request: string; response: string } | null;
    getWebSocketAutoResponseTimestamp(ws: ServerWebSocket<any>): Date | null;
  }

  /** The `server` a Durable Object's `fetch(request, server)` is given. */
  interface DurableObjectServer {
    /**
     * Upgrades the request to a WebSocket that is this object's (see
     * {@link DurableObjectState.acceptWebSocket}). `data` becomes `ws.data`.
     */
    upgrade(
      request: Request,
      options?: { data?: unknown; headers?: HeadersInit | undefined; tags?: string[] | undefined },
    ): boolean;
    requestIP(request: Request): SocketAddress | null;
    timeout(request: Request, seconds: number): void;
    publish(topic: string, data: string | ArrayBufferView | ArrayBuffer, compress?: boolean): number;
    subscriberCount(topic: string): number;
    readonly url: URL;
    readonly port: number | undefined;
    readonly hostname: string | undefined;
    readonly development: boolean;
    readonly id: string;
    readonly address: SocketAddress | null;
    readonly protocol: "http" | "https" | null;
    readonly pendingRequests: number;
    readonly pendingWebSockets: number;
  }

  interface DurableObjectListOptions {
    start?: string | undefined;
    startAfter?: string | undefined;
    end?: string | undefined;
    prefix?: string | undefined;
    reverse?: boolean | undefined;
    limit?: number | undefined;
  }

  /**
   * `ctx.storage`: the object's own SQLite database.
   *
   * Writes made without an `await` in between are committed together, and
   * nothing the object returns or sends through `ctx` leaves before they are.
   */
  interface DurableObjectStorage {
    /** Run SQL on the object's database. */
    readonly sql: DurableObjectSql;
    /** The key-value store, synchronously. */
    readonly kv: DurableObjectKv;

    get<T = unknown>(key: string): Promise<T | undefined>;
    get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
    list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
    put<T>(key: string, value: T): Promise<void>;
    put<T>(entries: Record<string, T>): Promise<void>;
    delete(key: string): Promise<boolean>;
    delete(keys: string[]): Promise<number>;
    /** Deletes everything the object stored: keys, tables made with `sql`, and the alarm. */
    deleteAll(): Promise<void>;
    /**
     * What `closure` writes through `txn` is kept in memory and applied, all or
     * nothing, when its promise fulfills; nothing is applied when it rejects or
     * calls `txn.rollback()`. Other events are not held back meanwhile. For
     * writes that must not interleave with anything, use `transactionSync()`.
     */
    transaction<T>(closure: (txn: DurableObjectTransaction) => T | Promise<T>): Promise<T>;
    /** What `closure` writes is kept when it returns and rolled back when it throws. */
    transactionSync<T>(closure: () => T): T;
    sync(): Promise<void>;
    getAlarm(): Promise<number | null>;
    /** One alarm per object; setting it again moves it. */
    setAlarm(scheduledTime: number | Date): Promise<void>;
    deleteAlarm(): Promise<void>;
  }

  interface DurableObjectTransaction {
    get<T = unknown>(key: string): Promise<T | undefined>;
    get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
    list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
    put<T>(key: string, value: T): Promise<void>;
    put<T>(entries: Record<string, T>): Promise<void>;
    delete(key: string): Promise<boolean>;
    delete(keys: string[]): Promise<number>;
    rollback(): void;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number | Date): Promise<void>;
    deleteAlarm(): Promise<void>;
  }

  /** `ctx.storage.kv` */
  interface DurableObjectKv {
    get<T = unknown>(key: string): T | undefined;
    /** Any value `structuredClone()` accepts. */
    put<T>(key: string, value: T): void;
    delete(key: string): boolean;
    list<T = unknown>(options?: DurableObjectListOptions): IterableIterator<[string, T]>;
  }

  type DurableObjectSqlValue = string | number | null | Uint8Array<ArrayBuffer>;

  /** `ctx.storage.sql` */
  interface DurableObjectSql {
    /**
     * Runs `query`. With several statements separated by `;`, the bindings and
     * the cursor are the last one's, and if one of them fails none of them
     * happened. Transactions are controlled with `transactionSync()`, not with
     * SQL; names that start with `_cf_` are reserved.
     *
     * A statement that reads is run as the cursor is iterated; rows not read
     * yet are gone if the object is evicted first. A statement that writes has
     * run to its end when `exec()` returns.
     */
    exec<T extends Record<string, DurableObjectSqlValue> = Record<string, DurableObjectSqlValue>>(
      query: string,
      ...bindings: (string | number | bigint | boolean | null | undefined | ArrayBufferView | ArrayBuffer)[]
    ): DurableObjectSqlCursor<T>;
    /** Bytes. */
    readonly databaseSize: number;
  }

  interface DurableObjectSqlCursor<T extends Record<string, DurableObjectSqlValue>> extends IterableIterator<T> {
    next(): IteratorResult<T, undefined>;
    toArray(): T[];
    /** The only row. Throws when there is none, or more than one. */
    one(): T;
    /** The same rows as arrays of column values. */
    raw<U extends DurableObjectSqlValue[] = DurableObjectSqlValue[]>(): IterableIterator<U> & { toArray(): U[] };
    readonly columnNames: string[];
    readonly rowsRead: number;
    readonly rowsWritten: number;
  }
}
