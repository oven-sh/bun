/**
 * "blob" is not supported yet
 */
type BinaryType = "nodebuffer" | "arraybuffer" | "blob";
type Transferable = ArrayBuffer | MessagePort;
type MessageEventSource = undefined;
type Encoding = "utf-8" | "windows-1252" | "utf-16";
type Platform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";
type Architecture =
  | "arm"
  | "arm64"
  | "ia32"
  | "mips"
  | "mipsel"
  | "ppc"
  | "ppc64"
  | "s390"
  | "s390x"
  | "x64";
type Signals =
  | "SIGABRT"
  | "SIGALRM"
  | "SIGBUS"
  | "SIGCHLD"
  | "SIGCONT"
  | "SIGFPE"
  | "SIGHUP"
  | "SIGILL"
  | "SIGINT"
  | "SIGIO"
  | "SIGIOT"
  | "SIGKILL"
  | "SIGPIPE"
  | "SIGPOLL"
  | "SIGPROF"
  | "SIGPWR"
  | "SIGQUIT"
  | "SIGSEGV"
  | "SIGSTKFLT"
  | "SIGSTOP"
  | "SIGSYS"
  | "SIGTERM"
  | "SIGTRAP"
  | "SIGTSTP"
  | "SIGTTIN"
  | "SIGTTOU"
  | "SIGUNUSED"
  | "SIGURG"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGVTALRM"
  | "SIGWINCH"
  | "SIGXCPU"
  | "SIGXFSZ"
  | "SIGBREAK"
  | "SIGLOST"
  | "SIGINFO";

interface ArrayConstructor {
  fromAsync<T>(
    asyncItems: AsyncIterable<T> | Iterable<T> | ArrayLike<T>,
    mapfn?: (value: any, index: number) => any,
    thisArg?: any,
  ): Promise<Array<T>>;
}

type UncaughtExceptionOrigin = "uncaughtException" | "unhandledRejection";
type MultipleResolveType = "resolve" | "reject";
type BeforeExitListener = (code: number) => void;
type DisconnectListener = () => void;
type ExitListener = (code: number) => void;
type RejectionHandledListener = (promise: Promise<unknown>) => void;
type UncaughtExceptionListener = (
  error: Error,
  origin: UncaughtExceptionOrigin,
) => void;
/**
 * Most of the time the unhandledRejection will be an Error, but this should not be relied upon
 * as *anything* can be thrown/rejected, it is therefore unsafe to assume that the value is an Error.
 */
type UnhandledRejectionListener = (
  reason: unknown,
  promise: Promise<unknown>,
) => void;
type WarningListener = (warning: Error) => void;
type MessageListener = (message: unknown, sendHandle: unknown) => void;
type SignalsListener = (signal: Signals) => void;
type MultipleResolveListener = (
  type: MultipleResolveType,
  promise: Promise<unknown>,
  value: unknown,
) => void;
// type WorkerListener = (worker: Worker) => void;

interface Console {
  /**
   * Asynchronously read lines from standard input (fd 0)
   *
   * ```ts
   * for await (const line of console) {
   *   console.log(line);
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<string>;

  /**
   * Write text or bytes to stdout
   *
   * Unlike {@link console.log}, this does no formatting and doesn't add a
   * newline or spaces between arguments. You can pass it strings or bytes or
   * any combination of the two.
   *
   * ```ts
   * console.write("hello world!", "\n"); // "hello world\n"
   * ```
   *
   * @param data - The data to write
   * @returns The number of bytes written
   *
   * This function is not available in the browser.
   */
  write(...data: Array<string | ArrayBufferView | ArrayBuffer>): number;

  /**
   * Clear the console
   */
  clear(): void;

  assert(condition?: boolean, ...data: any[]): void;

  /**
   * Increment a [count](https://www.youtube.com/watch?v=2AoxCkySv34&t=22s)
   * @param label label counter
   */
  count(label?: string): void;
  countReset(label?: string): void;
  debug(...data: any[]): void;
  dir(item?: any, options?: any): void;
  dirxml(...data: any[]): void;
  /**
   * Log to stderr in your terminal
   *
   * Appears in red
   *
   * @param data something to display
   */
  error(...data: any[]): void;
  /** Does nothing currently */
  group(...data: any[]): void;
  /** Does nothing currently */
  groupCollapsed(...data: any[]): void;
  /** Does nothing currently */
  groupEnd(): void;
  info(...data: any[]): void;
  log(...data: any[]): void;
  /** Does nothing currently */
  table(tabularData?: any, properties?: string[]): void;
  /**
   * Begin a timer to log with {@link console.timeEnd}
   *
   * @param label - The label to use for the timer
   *
   * ```ts
   *  console.time("how long????");
   * for (let i = 0; i < 999999; i++) {
   *    // do stuff
   *    let x = i * i;
   * }
   * console.timeEnd("how long????");
   * ```
   */
  time(label?: string): void;
  /**
   * End a timer to log with {@link console.time}
   *
   * @param label - The label to use for the timer
   *
   * ```ts
   *  console.time("how long????");
   * for (let i = 0; i < 999999; i++) {
   *  // do stuff
   *  let x = i * i;
   * }
   * console.timeEnd("how long????");
   * ```
   */
  timeEnd(label?: string): void;
  timeLog(label?: string, ...data: any[]): void;
  timeStamp(label?: string): void;
  trace(...data: any[]): void;
  warn(...data: any[]): void;
}

declare var console: Console;

declare namespace NodeJS {
  interface RequireResolve {
    (id: string, options?: { paths?: string[] | undefined }): string;
    paths(request: string): string[] | null;
  }

  interface Require {
    (id: string): any;
    resolve: RequireResolve;
  }
  interface ProcessEnv {}
  type Signals =
    | "SIGABRT"
    | "SIGALRM"
    | "SIGBUS"
    | "SIGCHLD"
    | "SIGCONT"
    | "SIGFPE"
    | "SIGHUP"
    | "SIGILL"
    | "SIGINT"
    | "SIGIO"
    | "SIGIOT"
    | "SIGKILL"
    | "SIGPIPE"
    | "SIGPOLL"
    | "SIGPROF"
    | "SIGPWR"
    | "SIGQUIT"
    | "SIGSEGV"
    | "SIGSTKFLT"
    | "SIGSTOP"
    | "SIGSYS"
    | "SIGTERM"
    | "SIGTRAP"
    | "SIGTSTP"
    | "SIGTTIN"
    | "SIGTTOU"
    | "SIGUNUSED"
    | "SIGURG"
    | "SIGUSR1"
    | "SIGUSR2"
    | "SIGVTALRM"
    | "SIGWINCH"
    | "SIGXCPU"
    | "SIGXFSZ"
    | "SIGBREAK"
    | "SIGLOST"
    | "SIGINFO";
}

interface ImportMeta {
  /**
   * `file://` url string for the current module.
   *
   * @example
   * ```ts
   * console.log(import.meta.url);
   * "file:///Users/me/projects/my-app/src/my-app.ts"
   * ```
   */
  readonly url: string;
  /**
   * Absolute path to the source file
   */
  readonly path: string;
  /**
   * Absolute path to the directory containing the source file.
   *
   * Does not have a trailing slash
   */
  readonly dir: string;
  /**
   * Filename of the source file
   */
  readonly file: string;
  /**
   * Resolve a module ID the same as if you imported it
   *
   * On failure, throws a `ResolveMessage`
   */
  resolve(moduleId: string): Promise<string>;
  /**
   * Resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveMessage`
   */
  // tslint:disable-next-line:unified-signatures
  resolve(moduleId: string, parent: string): Promise<string>;

  /**
   * Resolve a module ID the same as if you imported it
   *
   * The `parent` argument is optional, and defaults to the current module's path.
   */
  resolveSync(moduleId: string, parent?: string): string;

  /**
   * Load a CommonJS module
   *
   * Internally, this is a synchronous version of ESModule's `import()`, with extra code for handling:
   * - CommonJS modules
   * - *.node files
   * - *.json files
   *
   * Warning: **This API is not stable** and may change in the future. Use at your
   * own risk. Usually, you should use `require` instead and Bun's transpiler
   * will automatically rewrite your code to use `import.meta.require` if
   * relevant.
   */
  require: NodeJS.Require;

  /**
   * Did the current file start the process?
   *
   * @example
   * ```ts
   * if (import.meta.main) {
   *  console.log("I started the process!");
   * }
   * ```
   *
   * @example
   * ```ts
   * console.log(
   *   import.meta.main === (import.meta.path === Bun.main)
   * )
   * ```
   */
  readonly main: boolean;
}

/**
 * NodeJS-style `require` function
 *
 * Internally, uses `import.meta.require`
 *
 * @param moduleId - The module ID to resolve
 */
declare var require: NodeJS.Require;

/** @deprecated Please use `import.meta.path` instead. */
declare var __filename: string;

/** @deprecated Please use `import.meta.dir` instead. */
declare var __dirname: string;

interface StructuredSerializeOptions {
  transfer?: Transferable[];
}

/**
 * Creates a deep clone of an object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/structuredClone)
 */
declare function structuredClone<T>(
  value: T,
  options?: StructuredSerializeOptions,
): T;

declare var MessagePort: typeof import("worker_threads").MessagePort;
declare type MessagePort = import("worker_threads").MessagePort;
declare var MessageChannel: typeof import("worker_threads").MessageChannel;
declare type MessageChannel = import("worker_threads").MessageChannel;
declare var BroadcastChannel: typeof import("worker_threads").BroadcastChannel;
declare type BroadcastChannel = import("worker_threads").BroadcastChannel;

interface AbstractWorkerEventMap {
  error: ErrorEvent;
}

interface WorkerEventMap extends AbstractWorkerEventMap {
  message: MessageEvent;
  messageerror: MessageEvent;
  close: CloseEvent;
  open: Event;
}

interface AbstractWorker {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker/error_event) */
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null;
  addEventListener<K extends keyof AbstractWorkerEventMap>(
    type: K,
    listener: (this: AbstractWorker, ev: AbstractWorkerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AbstractWorkerEventMap>(
    type: K,
    listener: (this: AbstractWorker, ev: AbstractWorkerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/**
 * Bun's Web Worker constructor supports some extra options on top of the API browsers have.
 */
interface WorkerOptions {
  /**
   * A string specifying an identifying name for the DedicatedWorkerGlobalScope representing the scope of
   * the worker, which is mainly useful for debugging purposes.
   */
  name?: string;

  /**
   * Use less memory, but make the worker slower.
   *
   * Internally, this sets the heap size configuration in JavaScriptCore to be
   * the small heap instead of the large heap.
   */
  smol?: boolean;

  /**
   * When `true`, the worker will keep the parent thread alive until the worker is terminated or `unref`'d.
   * When `false`, the worker will not keep the parent thread alive.
   *
   * By default, this is `false`.
   */
  ref?: boolean;

  /**
   * In Bun, this does nothing.
   */
  type?: string;

  /**
   * List of arguments which would be stringified and appended to
   * `Bun.argv` / `process.argv` in the worker. This is mostly similar to the `data`
   * but the values will be available on the global `Bun.argv` as if they
   * were passed as CLI options to the script.
   */
  // argv?: any[] | undefined;

  /** If `true` and the first argument is a string, interpret the first argument to the constructor as a script that is executed once the worker is online. */
  // eval?: boolean | undefined;

  /**
   * If set, specifies the initial value of process.env inside the Worker thread. As a special value, worker.SHARE_ENV may be used to specify that the parent thread and the child thread should share their environment variables; in that case, changes to one thread's process.env object affect the other thread as well. Default: process.env.
   */
  env?:
    | Record<string, string>
    | typeof import("node:worker_threads")["SHARE_ENV"]
    | undefined;

  /**
   * In Bun, this does nothing.
   */
  credentials?: string;

  /**
   * @default true
   */
  // trackUnmanagedFds?: boolean;

  // resourceLimits?: import("worker_threads").ResourceLimits;
}

interface Worker extends EventTarget, AbstractWorker {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker/message_event) */
  onmessage: ((this: Worker, ev: MessageEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker/messageerror_event) */
  onmessageerror: ((this: Worker, ev: MessageEvent) => any) | null;
  /**
   * Clones message and transmits it to worker's global environment. transfer can be passed as a list of objects that are to be transferred rather than cloned.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker/postMessage)
   */
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
  /**
   * Aborts worker's associated global environment.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker/terminate)
   */
  terminate(): void;
  addEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;

  /**
   * Opposite of `unref()`, calling `ref()` on a previously `unref()`ed worker does _not_ let the program exit if it's the only active handle left (the default
   * behavior). If the worker is `ref()`ed, calling `ref()` again has
   * no effect.
   * @since v10.5.0
   */
  ref(): void;
  /**
   * Calling `unref()` on a worker allows the thread to exit if this is the only
   * active handle in the event system. If the worker is already `unref()`ed calling`unref()` again has no effect.
   * @since v10.5.0
   */
  unref(): void;

  threadId: number;
}

declare var Worker: {
  prototype: Worker;
  new (scriptURL: string | URL, options?: WorkerOptions): Worker;
  /**
   * This is the cloned value of the `data` property passed to `new Worker()`
   *
   * This is Bun's equivalent of `workerData` in Node.js.
   */
  data: any;
};

interface EncodeIntoResult {
  /**
   * The read Unicode code units of input.
   */
  read: number;
  /**
   * The written UTF-8 bytes of output.
   */
  written: number;
}

interface Process {
  /**
   * A Node.js LTS version
   *
   * To see the current Bun version, use {@link Bun.version}
   */
  version: string;
  /**
   * Run a function on the next tick of the event loop
   *
   * This is the same as {@link queueMicrotask}
   *
   * @param callback - The function to run
   */
  nextTick(callback: (...args: any) => any, ...args: any): void;
  title: string;
  exitCode: number;
  browser: boolean;
  versions: Record<string, string>;
  ppid: number;
  hrtime: {
    (time?: [number, number]): [number, number];
    bigint(): bigint;
  };
  pid: number;
  arch: Architecture;
  platform: Platform;
  argv: string[];
  execArgv: string[];
  env: import("bun").Env;
  allowedNodeEnvironmentFlags: Set<string>;
  debugPort: number;

  /** Whether you are using Bun */
  isBun: 1; // FIXME: this should actually return a boolean
  /** The current git sha of Bun **/
  revision: string;
  chdir(directory: string): void;
  cwd(): string;
  exit(code?: number): never;
  reallyExit(code?: number): never;
  getgid(): number;
  // setgid(id: number | string): void;
  getuid(): number;
  // setuid(id: number | string): void;
  geteuid: () => number;
  // seteuid: (id: number | string) => void;
  getegid: () => number;
  // setegid: (id: number | string) => void;
  getgroups: () => number[];
  // setgroups?: (groups: ReadonlyArray<string | number>) => void;
  dlopen(module: { exports: any }, filename: string, flags?: number): void;
  stdin: import("tty").ReadStream;
  stdout: import("tty").WriteStream;
  stderr: import("tty").WriteStream;

  /**
   *
   * @deprecated This is deprecated; use the "node:assert" module instead.
   */
  assert(value: unknown, message?: string | Error): asserts value;

  /**
   * exit the process with a fatal exception, sending SIGABRT
   */
  abort(): never;

  /**
   * Resolved absolute file path to the current Bun executable that is running
   */
  readonly execPath: string;
  /**
   * The original argv[0] passed to Bun
   */
  readonly argv0: string;

  /**
   * Number of seconds the process has been running
   *
   * This uses a high-resolution timer, but divides from nanoseconds to seconds
   * so there may be some loss of precision.
   *
   * For a more precise value, use `performance.timeOrigin` and `performance.now()` instead.
   */
  uptime(): number;

  /**
   * Bun process's file mode creation mask.
   *
   * @returns Bun process's file mode creation mask.
   */
  umask(mask?: number): number;

  emitWarning(warning: string | Error /*name?: string, ctor?: Function*/): void;

  readonly config: Object;

  memoryUsage: {
    (delta?: MemoryUsageObject): MemoryUsageObject;

    rss(): number;
  };

  cpuUsage(previousValue?: CPUUsageObject): CPUUsageObject;

  /**
   * Does nothing in Bun
   */
  setSourceMapsEnabled(enabled: boolean): void;

  kill(pid: number, signal?: string | number): void;

  on(event: "beforeExit", listener: BeforeExitListener): this;
  // on(event: "disconnect", listener: DisconnectListener): this;
  on(event: "exit", listener: ExitListener): this;
  // on(event: "rejectionHandled", listener: RejectionHandledListener): this;
  // on(event: "uncaughtException", listener: UncaughtExceptionListener): this;
  // on(
  //   event: "uncaughtExceptionMonitor",
  //   listener: UncaughtExceptionListener,
  // ): this;
  // on(event: "unhandledRejection", listener: UnhandledRejectionListener): this;
  // on(event: "warning", listener: WarningListener): this;
  // on(event: "message", listener: MessageListener): this;
  on(event: Signals, listener: SignalsListener): this;
  // on(event: "multipleResolves", listener: MultipleResolveListener): this;
  // on(event: "worker", listener: WorkerListener): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: "beforeExit", listener: BeforeExitListener): this;
  // once(event: "disconnect", listener: DisconnectListener): this;
  once(event: "exit", listener: ExitListener): this;
  // once(event: "rejectionHandled", listener: RejectionHandledListener): this;
  // once(event: "uncaughtException", listener: UncaughtExceptionListener): this;
  // once(
  //   event: "uncaughtExceptionMonitor",
  //   listener: UncaughtExceptionListener,
  // ): this;
  // once(event: "unhandledRejection", listener: UnhandledRejectionListener): this;
  // once(event: "warning", listener: WarningListener): this;
  // once(event: "message", listener: MessageListener): this;
  once(event: Signals, listener: SignalsListener): this;
  // once(event: "multipleResolves", listener: MultipleResolveListener): this;
  // once(event: "worker", listener: WorkerListener): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;

  /**
   * Returns the number of listeners listening for the event named `eventName`.
   * If `listener` is provided, it will return how many times the listener is found
   * in the list of the listeners of the event.
   * @since v3.2.0
   * @param eventName The name of the event being listened for
   * @param listener The event handler function
   */
  listenerCount(eventName: string | symbol, listener?: Function): number;
}

interface MemoryUsageObject {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface CPUUsageObject {
  user: number;
  system: number;
}

declare var process: Process;

declare module "process" {
  var process: Process;
  export = process;
}
declare module "node:process" {
  import process = require("process");
  export = process;
}

interface BlobInterface {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<TJSONReturnType = any>(): Promise<TJSONReturnType>;
  formData(): Promise<FormData>;
}

type BlobPart = string | Blob | BufferSource;
interface BlobPropertyBag {
  /** Set a default "type" */
  type?: string;

  /** Not implemented in Bun yet. */
  endings?: "transparent" | "native";
}

/**
 * This Fetch API interface allows you to perform various actions on HTTP
 * request and response headers. These actions include retrieving, setting,
 * adding to, and removing. A Headers object has an associated header list,
 * which is initially empty and consists of zero or more name and value
 * pairs.
 *
 * You can add to this using methods like append()
 *
 * In all methods of this interface, header names are matched by
 * case-insensitive byte sequence.
 */
interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  forEach(
    callbackfn: (value: string, key: string, parent: Headers) => void,
    thisArg?: any,
  ): void;

  /**
   * Convert {@link Headers} to a plain JavaScript object.
   *
   * About 10x faster than `Object.fromEntries(headers.entries())`
   *
   * Called when you run `JSON.stringify(headers)`
   *
   * Does not preserve insertion order. Well-known header names are lowercased. Other header names are left as-is.
   */
  toJSON(): Record<string, string>;

  /**
   * Get the total number of headers
   */
  readonly count: number;

  /**
   * Get all headers matching the name
   *
   * Only supports `"Set-Cookie"`. All other headers are empty arrays.
   *
   * @param name - The header name to get
   *
   * @returns An array of header values
   *
   * @example
   * ```ts
   * const headers = new Headers();
   * headers.append("Set-Cookie", "foo=bar");
   * headers.append("Set-Cookie", "baz=qux");
   * headers.getAll("Set-Cookie"); // ["foo=bar", "baz=qux"]
   * ```
   */
  getAll(name: "set-cookie" | "Set-Cookie"): string[];
}

declare var Headers: {
  prototype: Headers;
  new (init?: HeadersInit): Headers;
};

type HeadersInit =
  | Headers
  | Record<string, string>
  | Array<[string, string]>
  | IterableIterator<[string, string]>;
type ResponseType =
  | "basic"
  | "cors"
  | "default"
  | "error"
  | "opaque"
  | "opaqueredirect";

type FormDataEntryValue = File | string;

/** Provides a way to easily construct a set of key/value pairs representing
 * form fields and their values, which can then be easily sent using the
 * XMLHttpRequest.send() method. It uses the same format a form would use if the
 * encoding type were set to "multipart/form-data".
 */
interface FormData {
  /**
   * Appends a new value onto an existing key inside a FormData object, or adds
   * the key if it does not already exist.
   *
   * @param name The name of the field whose data is contained in value.
   * @param value The field's value.
   * @param fileName The filename reported to the server.
   *
   * ## Upload a file
   * ```ts
   * const formData = new FormData();
   * formData.append("username", "abc123");
   * formData.append("avatar", Bun.file("avatar.png"), "avatar.png");
   * await fetch("https://example.com", { method: "POST", body: formData });
   * ```
   */
  append(name: string, value: string | Blob, fileName?: string): void;
  delete(name: string): void;
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  set(name: string, value: string | Blob, fileName?: string): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<FormDataEntryValue>;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
  forEach(
    callback: (value: FormDataEntryValue, key: string, parent: this) => void,
    thisArg?: any,
  ): void;
}

declare var FormData: {
  prototype: FormData;
  new (): FormData;
};

declare interface Blob {
  /**
   * Create a new view **without 🚫 copying** the underlying data.
   *
   * Similar to [`BufferSource.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BufferSource/subarray)
   *
   * @param begin The index that sets the beginning of the view.
   * @param end The index that sets the end of the view.
   *
   */
  slice(begin?: number, end?: number, contentType?: string): Blob;

  /**
   * Create a new view **without 🚫 copying** the underlying data.
   *
   * Similar to [`BufferSource.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BufferSource/subarray)
   *
   * @param begin The index that sets the beginning of the view.
   * @param end The index that sets the end of the view.
   *
   */
  slice(begin?: number, contentType?: string): Blob;

  /**
   * Create a new view **without 🚫 copying** the underlying data.
   *
   * Similar to [`BufferSource.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BufferSource/subarray)
   *
   * @param begin The index that sets the beginning of the view.
   * @param end The index that sets the end of the view.
   *
   */
  slice(contentType?: string): Blob;

  /**
   * Read the data from the blob as a string. It will be decoded from UTF-8.
   */
  text(): Promise<string>;

  /**
   * Read the data from the blob as a ReadableStream.
   */
  stream(chunkSize?: number): ReadableStream<Uint8Array>;

  /**
   * Read the data from the blob as an ArrayBuffer.
   *
   * This copies the data into a new ArrayBuffer.
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Read the data from the blob as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   *
   */
  json<TJSONReturnType = any>(): Promise<TJSONReturnType>;

  /**
   * Read the data from the blob as a {@link FormData} object.
   *
   * This first decodes the data from UTF-8, then parses it as a
   * `multipart/form-data` body or a `application/x-www-form-urlencoded` body.
   *
   * The `type` property of the blob is used to determine the format of the
   * body.
   *
   * This is a non-standard addition to the `Blob` API, to make it conform more
   * closely to the `BodyMixin` API.
   */
  formData(): Promise<FormData>;

  type: string;
  readonly size: number;
}
declare var Blob: {
  prototype: Blob;
  /**
   * Create a new [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   *
   * @param `parts` - An array of strings, numbers, BufferSource, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
   * @param `options` - An object containing properties to be added to the [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   */
  new (parts?: BlobPart[], options?: BlobPropertyBag): Blob;
};

interface File extends Blob {
  readonly lastModified: number;
  readonly name: string;
}

declare var File: {
  prototype: File;

  /**
   * Create a new [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
   *
   * @param `parts` - An array of strings, numbers, BufferSource, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
   * @param `name` - The name of the file
   * @param `options` - An object containing properties to be added to the [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
   */
  new (
    parts: BlobPart[],
    name: string,
    options?: BlobPropertyBag & { lastModified?: Date | number },
  ): File;
};

interface ResponseInit {
  headers?: HeadersInit;
  /** @default 200 */
  status?: number | bigint;

  /** @default "OK" */
  statusText?: string;
}

/**
 * Represents an HTTP [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response)
 *
 * Use it to get the body of the response, the status code, and other information.
 *
 * @example
 * ```ts
 * const response: Response = await fetch("https://remix.run");
 * await response.text();
 * ```
 * @example
 * ```ts
 * const response: Response = await fetch("https://remix.run");
 * await Bun.write("remix.html", response);
 * ```
 */
declare class Response implements BlobInterface {
  constructor(
    body?:
      | ReadableStream
      | BlobPart
      | BlobPart[]
      | FormData
      | URLSearchParams
      | null,
    options?: ResponseInit,
  );

  /**
   * Create a new {@link Response} with a JSON body
   *
   * @param body - The body of the response
   * @param options - options to pass to the response
   *
   * @example
   *
   * ```ts
   * const response = Response.json({hi: "there"});
   * console.assert(
   *   await response.text(),
   *   `{"hi":"there"}`
   * );
   * ```
   * -------
   *
   * This is syntactic sugar for:
   * ```js
   *  new Response(JSON.stringify(body), {headers: { "Content-Type": "application/json" }})
   * ```
   * @link https://github.com/whatwg/fetch/issues/1389
   */
  static json(body?: any, options?: ResponseInit | number): Response;
  /**
   * Create a new {@link Response} that redirects to url
   *
   * @param url - the URL to redirect to
   * @param status - the HTTP status code to use for the redirect
   */
  // tslint:disable-next-line:unified-signatures
  static redirect(url: string, status?: number): Response;

  /**
   * Create a new {@link Response} that redirects to url
   *
   * @param url - the URL to redirect to
   * @param options - options to pass to the response
   */
  // tslint:disable-next-line:unified-signatures
  static redirect(url: string, options?: ResponseInit): Response;

  /**
   * Create a new {@link Response} that has a network error
   */
  static error(): Response;

  /**
   * HTTP [Headers](https://developer.mozilla.org/en-US/docs/Web/API/Headers) sent with the response.
   *
   * @example
   * ```ts
   * const {headers} = await fetch("https://remix.run");
   * headers.get("Content-Type");
   * headers.get("Content-Length");
   * headers.get("Set-Cookie");
   * ```
   */
  readonly headers: Headers;

  /**
   * HTTP response body as a [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
   *
   * This is part of web Streams
   *
   * @example
   * ```ts
   * const {body} = await fetch("https://remix.run");
   * const reader = body.getReader();
   * const {done, value} = await reader.read();
   * console.log(value); // Uint8Array
   * ```
   */
  readonly body: ReadableStream | null;

  /**
   * Has the body of the response already been consumed?
   */
  readonly bodyUsed: boolean;

  /**
   * Read the data from the Response as a string. It will be decoded from UTF-8.
   *
   * When the body is valid latin1, this operation is zero copy.
   */
  text(): Promise<string>;

  /**
   * Read the data from the Response as a string. It will be decoded from UTF-8.
   *
   * When the body is valid latin1, this operation is zero copy.
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Read the data from the Response as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   *
   */
  json<TJSONReturnType = any>(): Promise<TJSONReturnType>;

  /**
   * Read the data from the Response as a Blob.
   *
   * This allows you to reuse the underlying data.
   *
   * @returns Promise<Blob> - The body of the response as a {@link Blob}.
   */
  blob(): Promise<Blob>;

  /**
   * Read the data from the Response as a {@link FormData} object.
   *
   * This first decodes the data from UTF-8, then parses it as a
   * `multipart/form-data` body or a `application/x-www-form-urlencoded` body.
   *
   * If no `Content-Type` header is present, the promise will be rejected.
   *
   * @returns Promise<FormData> - The body of the response as a {@link FormData}.
   */
  formData(): Promise<FormData>;

  readonly ok: boolean;
  readonly redirected: boolean;
  /**
   * HTTP status code
   *
   * @example
   * 200
   *
   * 0 for network errors
   */
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  /** HTTP url as a string */
  readonly url: string;

  /** Copy the Response object into a new Response, including the body */
  clone(): Response;
}

type RequestCache =
  | "default"
  | "force-cache"
  | "no-cache"
  | "no-store"
  | "only-if-cached"
  | "reload";
type RequestCredentials = "include" | "omit" | "same-origin";
type RequestDestination =
  | ""
  | "audio"
  | "audioworklet"
  | "document"
  | "embed"
  | "font"
  | "frame"
  | "iframe"
  | "image"
  | "manifest"
  | "object"
  | "paintworklet"
  | "report"
  | "script"
  | "sharedworker"
  | "style"
  | "track"
  | "video"
  | "worker"
  | "xslt";
type RequestMode = "cors" | "navigate" | "no-cors" | "same-origin";
type RequestRedirect = "error" | "follow" | "manual";
type ReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";
// type RequestInfo = Request | string | RequestInit;

type BodyInit = ReadableStream | XMLHttpRequestBodyInit | URLSearchParams;
type XMLHttpRequestBodyInit = Blob | BufferSource | string | FormData;
type ReadableStreamController<T> = ReadableStreamDefaultController<T>;
type ReadableStreamDefaultReadResult<T> =
  | ReadableStreamDefaultReadValueResult<T>
  | ReadableStreamDefaultReadDoneResult;
interface ReadableStreamDefaultReadManyResult<T> {
  done: boolean;
  /** Number of bytes */
  size: number;
  value: T[];
}
type ReadableStreamReader<T> = ReadableStreamDefaultReader<T>;

interface RequestInit {
  /**
   * A BodyInit object or null to set request's body.
   */
  body?: BodyInit | null;
  /**
   * A string indicating how the request will interact with the browser's cache to set request's cache.
   *
   * Note: as of Bun v0.5.7, this is not implemented yet.
   */
  cache?: RequestCache;
  /**
   * A string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. Sets request's credentials.
   */
  credentials?: RequestCredentials;
  /**
   * A Headers object, an object literal, or an array of two-item arrays to set request's headers.
   */
  headers?: HeadersInit;
  /**
   * A cryptographic hash of the resource to be fetched by request. Sets request's integrity.
   *
   * Note: as of Bun v0.5.7, this is not implemented yet.
   */
  integrity?: string;
  /**
   * A boolean to set request's keepalive.
   *
   * Available in Bun v0.2.0 and above.
   *
   * This is enabled by default
   */
  keepalive?: boolean;
  /**
   * A string to set request's method.
   */
  method?: string;
  /**
   * A string to indicate whether the request will use CORS, or will be restricted to same-origin URLs. Sets request's mode.
   */
  mode?: RequestMode;
  /**
   * A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect.
   */
  redirect?: RequestRedirect;
  /**
   * A string whose value is a same-origin URL, "about:client", or the empty string, to set request's referrer.
   */
  referrer?: string;
  /**
   * A referrer policy to set request's referrerPolicy.
   */
  referrerPolicy?: ReferrerPolicy;
  /**
   * An AbortSignal to set request's signal.
   */
  signal?: AbortSignal | null;
  /**
   * Can only be null. Used to disassociate request from any Window.
   *
   * This does nothing in Bun
   */
  window?: any;

  /**
   * Enable or disable HTTP request timeout
   */
  timeout?: boolean;
}

interface FetchRequestInit extends RequestInit {
  /**
   * Log the raw HTTP request & response to stdout. This API may be
   * removed in a future version of Bun without notice.
   * This is a custom property that is not part of the Fetch API specification.
   * It exists mostly as a debugging tool
   */
  verbose?: boolean;
  /**
   * Override http_proxy or HTTPS_PROXY
   * This is a custom property that is not part of the Fetch API specification.
   */
  proxy?: string;
}

/**
 * [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) represents an HTTP request.
 *
 * @example
 * ```ts
 * const request = new Request("https://remix.run/");
 * await fetch(request);
 * ```
 *
 * @example
 * ```ts
 * const request = new Request("https://remix.run/");
 * await fetch(request);
 * ```
 */
declare class Request implements BlobInterface {
  // Request | string | RequestInit;
  constructor(requestInfo: string, requestInit?: RequestInit);
  constructor(requestInfo: RequestInit & { url: string });
  constructor(requestInfo: Request, requestInit?: RequestInit);

  /**
   * Read or write the HTTP headers for this request.
   *
   * @example
   * ```ts
   * const request = new Request("https://remix.run/");
   * request.headers.set("Content-Type", "application/json");
   * request.headers.set("Accept", "application/json");
   * await fetch(request);
   * ```
   */
  headers: Headers;

  /**
   * The URL (as a string) corresponding to the HTTP request
   * @example
   * ```ts
   * const request = new Request("https://remix.run/");
   * request.url; // "https://remix.run/"
   * ```
   */
  readonly url: string;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a string. It will be decoded from UTF-8.
   *
   * When the body is valid latin1, this operation is zero copy.
   */
  text(): Promise<string>;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a {@link ReadableStream}.
   *
   * Streaming **outgoing** HTTP request bodies via `fetch()` is not yet supported in
   * Bun.
   *
   * Reading **incoming** HTTP request bodies via `ReadableStream` in `Bun.serve()` is supported
   * as of Bun v0.2.0.
   *
   *
   */
  get body(): ReadableStream | null;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as an ArrayBuffer.
   *
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   *
   */
  json<TJSONReturnType = any>(): Promise<TJSONReturnType>;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a `Blob`.
   *
   * This allows you to reuse the underlying data.
   *
   */
  blob(): Promise<Blob>;

  /**
   * Returns the cache mode associated with request, which is a string indicating how the request will interact with the browser's cache when fetching.
   */
  readonly cache: RequestCache;
  /**
   * Returns the credentials mode associated with request, which is a string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL.
   */
  readonly credentials: RequestCredentials;
  /**
   * Returns the kind of resource requested by request, e.g., "document" or "script".
   *
   * In Bun, this always returns "navigate".
   */
  readonly destination: RequestDestination;
  /**
   * Returns request's subresource integrity metadata, which is a cryptographic hash of the resource being fetched. Its value consists of multiple hashes separated by whitespace. [SRI]
   *
   * This does nothing in Bun right now.
   */
  readonly integrity: string;
  /**
   * Returns a boolean indicating whether or not request can outlive the global in which it was created.
   *
   * In Bun, this always returns false.
   */
  readonly keepalive: boolean;
  /**
   * Returns request's HTTP method, which is "GET" by default.
   */
  readonly method: string;
  /**
   * Returns the mode associated with request, which is a string indicating whether the request will use CORS, or will be restricted to same-origin URLs.
   */
  readonly mode: RequestMode;
  /**
   * Returns the redirect mode associated with request, which is a string indicating how redirects for the request will be handled during fetching. A request will follow redirects by default.
   */
  readonly redirect: RequestRedirect;
  /**
   * Returns the referrer of request. Its value can be a same-origin URL
   * if explicitly set in init, the empty string to indicate no referrer,
   * and "about:client" when defaulting to the global's default. This is
   * used during fetching to determine the value of the `Referer` header
   * of the request being made.
   */
  readonly referrer: string;
  /**
   * Returns the referrer policy associated with request. This is used during fetching to compute the value of the request's referrer.
   */
  readonly referrerPolicy: ReferrerPolicy;
  /**
   * Returns the signal associated with request, which is an AbortSignal object indicating whether or not request has been aborted, and its abort event handler.
   */
  readonly signal: AbortSignal;

  /** Copy the Request object into a new Request, including the body */
  clone(): Request;

  /**
   * Read the body from the Request as a {@link FormData} object.
   *
   * This first decodes the data from UTF-8, then parses it as a
   * `multipart/form-data` body or a `application/x-www-form-urlencoded` body.
   *
   * @returns Promise<FormData> - The body of the request as a {@link FormData}.
   */
  formData(): Promise<FormData>;

  /**
   * Has the body of the request been read?
   *
   * [Request.bodyUsed](https://developer.mozilla.org/en-US/docs/Web/API/Request/bodyUsed)
   */
  readonly bodyUsed: boolean;
}

declare interface Crypto {
  readonly subtle: SubtleCrypto;

  getRandomValues<T extends BufferSource = BufferSource>(array: T): T;
  /**
   * Generate a cryptographically secure random UUID.
   *
   * @example
   *
   * ```js
   * crypto.randomUUID()
   * '5e6adf82-f516-4468-b1e1-33d6f664d7dc'
   * ```
   */
  randomUUID(): string;
}
declare var Crypto: {
  prototype: Crypto;
  new (): Crypto;
};

declare var crypto: Crypto;

/**
 * [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob) decodes base64 into ascii text.
 *
 * @param asciiText The base64 string to decode.
 */
declare function atob(encodedData: string): string;

/**
 * [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/btoa) encodes ascii text into base64.
 *
 * @param stringToEncode The ascii text to encode.
 */
declare function btoa(stringToEncode: string): string;

/**
 * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextEncoder` API. All
 * instances of `TextEncoder` only support UTF-8 encoding.
 *
 * ```js
 * const encoder = new TextEncoder();
 * const uint8array = encoder.encode('this is some data');
 * ```
 *
 */
declare class TextEncoder {
  /**
   * The encoding supported by the `TextEncoder` instance. Always set to `'utf-8'`.
   */
  readonly encoding: "utf-8";

  constructor(encoding?: "utf-8");

  /**
   * UTF-8 encodes the `input` string and returns a `Uint8Array` containing the
   * encoded bytes.
   * @param [input='an empty string'] The text to encode.
   */
  encode(input?: string): Uint8Array;
  /**
   * UTF-8 encodes the `src` string to the `dest` Uint8Array and returns an object
   * containing the read Unicode code units and written UTF-8 bytes.
   *
   * ```js
   * const encoder = new TextEncoder();
   * const src = 'this is some data';
   * const dest = new Uint8Array(10);
   * const { read, written } = encoder.encodeInto(src, dest);
   * ```
   * @param src The text to encode.
   * @param dest The array to hold the encode result.
   */
  encodeInto(src?: string, dest?: BufferSource): EncodeIntoResult;
}

/**
 * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextDecoder` API.
 *
 * ```js
 * const decoder = new TextDecoder();
 * const u8arr = new Uint8Array([72, 101, 108, 108, 111]);
 * console.log(decoder.decode(u8arr)); // Hello
 * ```
 */
declare class TextDecoder {
  /**
   * The encoding supported by the `TextDecoder` instance.
   */
  readonly encoding: string;
  /**
   * The value will be `true` if decoding errors result in a `TypeError` being
   * thrown.
   */
  readonly fatal: boolean;
  /**
   * The value will be `true` if the decoding result will include the byte order
   * mark.
   */
  readonly ignoreBOM: boolean;

  constructor(
    encoding?: Encoding,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );

  /**
   * Decodes the `input` and returns a string. If `options.stream` is `true`, any
   * incomplete byte sequences occurring at the end of the `input` are buffered
   * internally and emitted after the next call to `textDecoder.decode()`.
   *
   * If `textDecoder.fatal` is `true`, decoding errors that occur will result in a`TypeError` being thrown.
   * @param input An `ArrayBuffer`, `DataView` or `BufferSource` instance containing the encoded data.
   */
  decode(input?: BufferSource | ArrayBuffer): string;
}

/**
 * ShadowRealms are a distinct global environment, with its own global object
 * containing its own intrinsics and built-ins (standard objects that are not
 * bound to global variables, like the initial value of Object.prototype).
 *
 *
 * @example
 *
 * ```js
 * const red = new ShadowRealm();
 *
 * // realms can import modules that will execute within it's own environment.
 * // When the module is resolved, it captured the binding value, or creates a new
 * // wrapped function that is connected to the callable binding.
 * const redAdd = await red.importValue('./inside-code.js', 'add');
 *
 * // redAdd is a wrapped function exotic object that chains it's call to the
 * // respective imported binding.
 * let result = redAdd(2, 3);
 *
 * console.assert(result === 5); // yields true
 *
 * // The evaluate method can provide quick code evaluation within the constructed
 * // shadowRealm without requiring any module loading, while it still requires CSP
 * // relaxing.
 * globalThis.someValue = 1;
 * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
 * console.assert(globalThis.someValue === 1);
 *
 * // The wrapped functions can also wrap other functions the other way around.
 * const setUniqueValue =
 * await red.importValue('./inside-code.js', 'setUniqueValue');
 *
 * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
 *
 * result = setUniqueValue((x) => x ** 3);
 *
 * console.assert(result === 16); // yields true
 * ```
 */
declare class ShadowRealm {
  /**
   * Creates a new [ShadowRealm](https://github.com/tc39/proposal-shadowrealm/blob/main/explainer.md#introduction)
   *
   * @example
   *
   * ```js
   * const red = new ShadowRealm();
   *
   * // realms can import modules that will execute within it's own environment.
   * // When the module is resolved, it captured the binding value, or creates a new
   * // wrapped function that is connected to the callable binding.
   * const redAdd = await red.importValue('./inside-code.js', 'add');
   *
   * // redAdd is a wrapped function exotic object that chains it's call to the
   * // respective imported binding.
   * let result = redAdd(2, 3);
   *
   * console.assert(result === 5); // yields true
   *
   * // The evaluate method can provide quick code evaluation within the constructed
   * // shadowRealm without requiring any module loading, while it still requires CSP
   * // relaxing.
   * globalThis.someValue = 1;
   * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
   * console.assert(globalThis.someValue === 1);
   *
   * // The wrapped functions can also wrap other functions the other way around.
   * const setUniqueValue =
   * await red.importValue('./inside-code.js', 'setUniqueValue');
   *
   * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
   *
   * result = setUniqueValue((x) => x ** 3);
   *
   * console.assert(result === 16); // yields true
   * ```
   */
  constructor();
  importValue(specifier: string, bindingName: string): Promise<any>;
  evaluate(sourceText: string): any;
}

declare var performance: {
  /**
   * Milliseconds since Bun.js started
   *
   * Uses a high-precision system timer to measure the time elapsed since the
   * Bun.js runtime was initialized. The value is represented as a double
   * precision floating point number. The value is monotonically increasing
   * during the lifetime of the runtime.
   *
   */
  now: () => number;

  /**
   * The timeOrigin read-only property of the Performance interface returns the
   * high resolution timestamp that is used as the baseline for
   * performance-related timestamps.
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin
   */
  readonly timeOrigin: number;
};

/**
 * Cancel a repeating timer by its timer ID.
 * @param id timer id
 */
declare function clearInterval(id?: number | Timer): void;
/**
 * Cancel a delayed function call by its timer ID.
 * @param id timer id
 */
declare function clearTimeout(id?: number | Timer): void;
/**
 * Cancel an immediate function call by its immediate ID.
 * @param id immediate id
 */
declare function clearImmediate(id?: number | Timer): void;
// declare function createImageBitmap(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
// declare function createImageBitmap(image: ImageBitmapSource, sx: number, sy: number, sw: number, sh: number, options?: ImageBitmapOptions): Promise<ImageBitmap>;

/**
 * Send a HTTP(s) request
 *
 * @param request Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 *
 *
 */
// tslint:disable-next-line:unified-signatures
declare function fetch(request: Request, init?: RequestInit): Promise<Response>;
/**
 * Send a HTTP(s) request
 *
 * @param url URL string
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 *
 *
 */
declare function fetch(
  url: string | URL | Request,
  init?: FetchRequestInit,
): Promise<Response>;

declare function queueMicrotask(callback: (...args: any[]) => void): void;
/**
 * Log an error using the default exception handler
 * @param error Error or string
 */
declare function reportError(error: any): void;

interface Timer {
  ref(): Timer;
  unref(): Timer;
  hasRef(): boolean;

  [Symbol.toPrimitive](): number;
}

/**
 * Run a function immediately after main event loop is vacant
 * @param handler function to call
 */
declare function setImmediate(
  handler: TimerHandler,
  ...arguments: any[]
): Timer;
/**
 * Run a function every `interval` milliseconds
 * @param handler function to call
 * @param interval milliseconds to wait between calls
 */
declare function setInterval(
  handler: TimerHandler,
  interval?: number,
  ...arguments: any[]
): Timer;
/**
 * Run a function after `timeout` (milliseconds)
 * @param handler function to call
 * @param timeout milliseconds to wait between calls
 */
declare function setTimeout(
  handler: TimerHandler,
  timeout?: number,
  ...arguments: any[]
): Timer;
declare function addEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | AddEventListenerOptions,
): void;
declare function addEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void;
declare function removeEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | EventListenerOptions,
): void;
declare function removeEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions,
): void;

// -----------------------
// -----------------------
// --- libdom.d.ts

interface ErrorEventInit extends EventInit {
  colno?: number;
  error?: any;
  filename?: string;
  lineno?: number;
  message?: string;
}

interface CloseEventInit extends EventInit {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

interface MessageEventInit<T = any> extends EventInit {
  data?: T;
  lastEventId?: string;
  origin?: string;
  source?: MessageEventSource;
}

interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

interface EventListenerOptions {
  capture?: boolean;
}

interface UIEventInit extends EventInit {
  detail?: number;
  view?: null;
  /** @deprecated */
  which?: number;
}

interface EventModifierInit extends UIEventInit {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  modifierAltGraph?: boolean;
  modifierCapsLock?: boolean;
  modifierFn?: boolean;
  modifierFnLock?: boolean;
  modifierHyper?: boolean;
  modifierNumLock?: boolean;
  modifierScrollLock?: boolean;
  modifierSuper?: boolean;
  modifierSymbol?: boolean;
  modifierSymbolLock?: boolean;
  shiftKey?: boolean;
}

interface EventSourceInit {
  withCredentials?: boolean;
}

/** A controller object that allows you to abort one or more DOM requests as and when desired. */
interface AbortController {
  /**
   * Returns the AbortSignal object associated with this object.
   */
  readonly signal: AbortSignal;
  /**
   * Invoking this method will set this object's AbortSignal's aborted flag and signal to any observers that the associated activity is to be aborted.
   */
  abort(reason?: any): void;
}

/** EventTarget is a DOM interface implemented by objects that can receive events and may have listeners for them. */
interface EventTarget {
  /**
   * Appends an event listener for events whose type attribute value is
   * type. The callback argument sets the callback that will be invoked
   * when the event is dispatched.
   *
   * The options argument sets listener-specific options. For
   * compatibility this can be a boolean, in which case the method behaves
   * exactly as if the value was specified as options's capture.
   *
   * When set to true, options's capture prevents callback from being
   * invoked when the event's eventPhase attribute value is
   * BUBBLING_PHASE. When false (or not present), callback will not be
   * invoked when event's eventPhase attribute value is CAPTURING_PHASE.
   * Either way,callback will be invoked if event's eventPhase attribute
   * value is AT_TARGET.
   *
   * When set to true, options's passive indicates that the callback will
   * not cancel the event by invoking preventDefault(). This is used to
   * enable performance optimizations described in § 2.8 Observing event
   * listeners.
   *
   * When set to true, options's once indicates that the callback will
   * only be invoked once after which the event listener will be removed.
   *
   * If an AbortSignal is passed for options's signal, then the event
   * listener will be removed when signal is aborted.
   *
   * The event listener is appended to target's event listener list and is
   * not appended if it has the same type, callback, and capture.
   */
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  /** Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise. */
  dispatchEvent(event: Event): boolean;
  /** Removes the event listener in target's event listener list with the same type, callback, and options. */
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
}

declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

/** An event which takes place in the DOM. */
interface Event<T extends EventTarget = EventTarget> {
  /**
   * Returns true or false depending on how event was initialized. True
   * if event goes through its target's ancestors in reverse tree order,
   * and false otherwise.
   */
  readonly bubbles: boolean;
  cancelBubble: boolean;
  /**
   * Returns true or false depending on how event was initialized. Its
   * return value does not always carry meaning, but true can indicate
   * that part of the operation during which event was dispatched, can be
   * canceled by invoking the preventDefault() method.
   */
  readonly cancelable: boolean;
  /**
   * Returns true or false depending on how event was initialized. True
   * if event invokes listeners past a ShadowRoot node that is the root of
   * its target, and false otherwise.
   */
  readonly composed: boolean;
  /**
   * Returns the object whose event listener's callback is currently
   * being invoked.
   */
  readonly currentTarget: T | null;
  /**
   * Returns true if preventDefault() was invoked successfully to
   * indicate cancelation, and false otherwise.
   */
  readonly defaultPrevented: boolean;
  /**
   * Returns the event's phase, which is one of NONE, CAPTURING_PHASE,
   * AT_TARGET, and BUBBLING_PHASE.
   */
  readonly eventPhase: number;
  /**
   * Returns true if event was dispatched by the user agent, and false
   * otherwise.
   */
  readonly isTrusted: boolean;
  /**
   * @deprecated
   */
  returnValue: boolean;
  /**
   * @deprecated
   */
  readonly srcElement: EventTarget | null;
  /**
   * Returns the object to which event is dispatched (its target).
   */
  readonly target: EventTarget | null;
  /**
   * Returns the event's timestamp as the number of milliseconds measured
   * relative to the time origin.
   */
  readonly timeStamp: DOMHighResTimeStamp;
  /**
   * Returns the type of event, e.g. "click", "hashchange", or "submit".
   */
  readonly type: string;
  /**
   * Returns the invocation target objects of event's path (objects on
   * which listeners will be invoked), except for any nodes in shadow
   * trees of which the shadow root's mode is "closed" that are not
   * reachable from event's currentTarget.
   */
  composedPath(): EventTarget[];
  /**
   * @deprecated
   */
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
  /**
   * If invoked when the cancelable attribute value is true, and while
   * executing a listener for the event with passive set to false, signals
   * to the operation that caused event to be dispatched that it needs to
   * be canceled.
   */
  preventDefault(): void;
  /**
   * Invoking this method prevents event from reaching any registered
   * event listeners after the current one finishes running and, when
   * dispatched in a tree, also prevents event from reaching any other
   * objects.
   */
  stopImmediatePropagation(): void;
  /**
   * When dispatched in a tree, invoking this method prevents event from
   * reaching any objects other than the current object.
   */
  stopPropagation(): void;
  readonly AT_TARGET: number;
  readonly BUBBLING_PHASE: number;
  readonly CAPTURING_PHASE: number;
  readonly NONE: number;
}

declare var Event: {
  prototype: Event;
  new (type: string, eventInitDict?: EventInit): Event;
  readonly AT_TARGET: number;
  readonly BUBBLING_PHASE: number;
  readonly CAPTURING_PHASE: number;
  readonly NONE: number;
};

/**
 * Events providing information related to errors in scripts or in files.
 */
interface ErrorEvent extends Event {
  readonly colno: number;
  readonly error: any;
  readonly filename: string;
  readonly lineno: number;
  readonly message: string;
}

declare var ErrorEvent: {
  prototype: ErrorEvent;
  new (type: string, eventInitDict?: ErrorEventInit): ErrorEvent;
};

/** A CloseEvent is sent to clients using WebSockets when the connection is closed. This is delivered to the listener indicated by the WebSocket object's onclose attribute. */
interface CloseEvent extends Event {
  /** Returns the WebSocket connection close code provided by the server. */
  readonly code: number;
  /** Returns the WebSocket connection close reason provided by the server. */
  readonly reason: string;
  /** Returns true if the connection closed cleanly; false otherwise. */
  readonly wasClean: boolean;
}

declare var CloseEvent: {
  prototype: CloseEvent;
  new (type: string, eventInitDict?: CloseEventInit): CloseEvent;
};

/** A message received by a target object. */
interface MessageEvent<T = any> extends Event {
  /** Returns the data of the message. */
  readonly data: T;
  /** Returns the last event ID string, for server-sent events. */
  readonly lastEventId: string;
  /** Returns the origin of the message, for server-sent events and cross-document messaging. */
  readonly origin: string;
  /** Returns the MessagePort array sent with the message, for cross-document messaging and channel messaging. */
  readonly ports: ReadonlyArray<MessagePort>;
  readonly source: MessageEventSource;
  /** @deprecated */
  initMessageEvent(
    type: string,
    bubbles?: boolean,
    cancelable?: boolean,
    data?: any,
    origin?: string,
    lastEventId?: string,
    source?: null,
  ): void;
}

declare var MessageEvent: {
  prototype: MessageEvent;
  new <T>(type: string, eventInitDict?: MessageEventInit<T>): MessageEvent<T>;
};

interface CustomEventInit<T = any> extends EventInit {
  detail?: T;
}

interface CustomEvent<T = any> extends Event {
  /** Returns any custom data event was created with. Typically used for synthetic events. */
  readonly detail: T;
  /** @deprecated */
  initCustomEvent(
    type: string,
    bubbles?: boolean,
    cancelable?: boolean,
    detail?: T,
  ): void;
}

declare var CustomEvent: {
  prototype: CustomEvent;
  new <T>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
};

/**
 * A map of WebSocket event names to event types.
 */
type WebSocketEventMap = {
  open: Event;
  message: MessageEvent<string | Buffer>;
  close: CloseEvent;
  ping: MessageEvent<Buffer>;
  pong: MessageEvent<Buffer>;
  error: Event;
};

/**
 * A state that represents if a WebSocket is connected.
 *
 * - `WebSocket.CONNECTING` is `0`, the connection is pending.
 * - `WebSocket.OPEN` is `1`, the connection is established and `send()` is possible.
 * - `WebSocket.CLOSING` is `2`, the connection is closing.
 * - `WebSocket.CLOSED` is `3`, the connection is closed or couldn't be opened.
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
 */
type WebSocketReadyState = 0 | 1 | 2 | 3;

/**
 * A client that makes an outgoing WebSocket connection.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
 * @example
 * const ws = new WebSocket("wss://ws.postman-echo.com/raw");
 *
 * ws.addEventListener("open", () => {
 *   console.log("Connected");
 * });
 * ws.addEventListener("message", ({ data }) => {
 *   console.log("Received:", data); // string or Buffer
 * });
 * ws.addEventListener("close", ({ code, reason }) => {
 *   console.log("Disconnected:", code, reason);
 * });
 */
interface WebSocket extends EventTarget {
  /**
   * Sends a message.
   *
   * @param data the string, ArrayBuffer, or ArrayBufferView to send
   * @example
   * let ws: WebSocket;
   * ws.send("Hello!");
   * ws.send(new TextEncoder().encode("Hello?"));
   */
  send(data: string | BufferSource): void;

  /**
   * Closes the connection.
   *
   * Here is a list of close codes:
   * - `1000` means "normal closure" **(default)**
   * - `1001` means the client is "going away"
   * - `1009` means a message was too big and was rejected
   * - `1011` means the server encountered an error
   * - `1012` means the server is restarting
   * - `1013` means the server is too busy or the client is rate-limited
   * - `4000` through `4999` are reserved for applications (you can use it!)
   *
   * To abruptly close the connection without a code, use `terminate()` instead.
   *
   * @param code the close code
   * @param reason the close reason
   * @example
   * let ws: WebSocket;
   * ws.close(1013, "Exceeded the rate limit of 100 messages per minute.");
   */
  close(code?: number, reason?: string): void;

  /**
   * Closes the connection, abruptly.
   *
   * To gracefuly close the connection, use `close()` instead.
   */
  terminate(): void;

  /**
   * Sends a ping.
   *
   * @param data the string, ArrayBuffer, or ArrayBufferView to send
   */
  ping(data?: string | BufferSource): void;

  /**
   * Sends a pong.
   *
   * @param data the string, ArrayBuffer, or ArrayBufferView to send
   */
  pong(data?: string | BufferSource): void;

  /**
   * Sets how binary data is returned in events.
   *
   * - if `nodebuffer`, binary data is returned as `Buffer` objects. **(default)**
   * - if `arraybuffer`, binary data is returned as `ArrayBuffer` objects.
   * - if `blob`, binary data is returned as `Blob` objects. **(not supported)**
   *
   * In browsers, the default is `blob`, however in Bun, the default is `nodebuffer`.
   *
   * @example
   * let ws: WebSocket;
   * ws.binaryType = "arraybuffer";
   * ws.addEventListener("message", ({ data }) => {
   *   console.log(data instanceof ArrayBuffer); // true
   * });
   */
  binaryType: BinaryType;

  /**
   * The ready state of the connection.
   *
   * - `WebSocket.CONNECTING` is `0`, the connection is pending.
   * - `WebSocket.OPEN` is `1`, the connection is established and `send()` is possible.
   * - `WebSocket.CLOSING` is `2`, the connection is closing.
   * - `WebSocket.CLOSED` is `3`, the connection is closed or couldn't be opened.
   */
  readonly readyState: WebSocketReadyState;

  /**
   * The resolved URL that established the connection.
   */
  readonly url: string;

  /**
   * The number of bytes that are queued, but not yet sent.
   *
   * When the connection is closed, the value is not reset to zero.
   */
  readonly bufferedAmount: number;

  /**
   * The protocol selected by the server, if any, otherwise empty.
   */
  readonly protocol: string;

  /**
   * The extensions selected by the server, if any, otherwise empty.
   */
  readonly extensions: string;

  /**
   * Sets the event handler for `open` events.
   *
   * If you need multiple event handlers, use `addEventListener("open")` instead.
   */
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;

  /**
   * Sets the event handler for `close` events.
   *
   * If you need multiple event handlers, use `addEventListener("close")` instead.
   */
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null;

  /**
   * Sets the event handler for `message` events.
   *
   * If you need multiple event handlers, use `addEventListener("message")` instead.
   */
  onmessage:
    | ((this: WebSocket, event: MessageEvent<string | Buffer>) => unknown)
    | null;

  /**
   * Sets the event handler for `error` events.
   *
   * If you need multiple event handlers, use `addEventListener("error")` instead.
   */
  onerror: ((this: WebSocket, event: Event) => unknown) | null;

  addEventListener<T extends keyof WebSocketEventMap>(
    type: T,
    listener: (this: WebSocket, event: WebSocketEventMap[T]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;

  addEventListener(
    type: string,
    listener: (this: WebSocket, event: Event) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<T extends keyof WebSocketEventMap>(
    type: T,
    listener: (this: WebSocket, event: WebSocketEventMap[T]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;

  removeEventListener(
    type: string,
    listener: (this: WebSocket, event: Event) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
}

/**
 * A client that makes an outgoing WebSocket connection.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
 * @example
 * const ws = new WebSocket("wss://ws.postman-echo.com/raw");
 *
 * ws.addEventListener("open", () => {
 *   console.log("Connected");
 * });
 * ws.addEventListener("message", ({ data }) => {
 *   console.log("Received:", data); // string or Buffer
 * });
 * ws.addEventListener("close", ({ code, reason }) => {
 *   console.log("Disconnected:", code, reason);
 * });
 */
declare var WebSocket: {
  prototype: WebSocket;

  new (url: string | URL, protocols?: string | string[]): WebSocket;

  new (
    url: string | URL,
    options: {
      /**
       * Sets the headers when establishing a connection.
       */
      headers?: HeadersInit;
      /**
       * Sets the sub-protocol the client is willing to accept.
       */
      protocol?: string;
      /**
       * Sets the sub-protocols the client is willing to accept.
       */
      protocols?: string[];
    },
  ): WebSocket;

  /**
   * The connection is pending.
   */
  readonly CONNECTING: 0;

  /**
   * The connection is established and `send()` is possible.
   */
  readonly OPEN: 1;

  /**
   * The connection is closing.
   */
  readonly CLOSING: 2;

  /**
   * The connection is closed or couldn't be opened.
   */
  readonly CLOSED: 3;
};

/**
 * The URL interface represents an object providing static methods used for
 * creating object URLs.
 */
interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  toString(): string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toJSON(): string;
}

interface URLSearchParams {
  /** Appends a specified key/value pair as a new search parameter. */
  append(name: string, value: string): void;
  /** Deletes the given search parameter, and its associated value, from the list of all search parameters. */
  delete(name: string): void;
  /** Returns the first value associated to the given search parameter. */
  get(name: string): string | null;
  /** Returns all the values association with a given search parameter. */
  getAll(name: string): string[];
  /** Returns a Boolean indicating if such a search parameter exists. */
  has(name: string): boolean;
  /** Sets the value associated to a given search parameter to the given value. If there were several values, delete the others. */
  set(name: string, value: string): void;
  sort(): void;
  entries(): IterableIterator<[string, string]>;
  /** Returns an iterator allowing to go through all keys of the key/value pairs of this search parameter. */
  keys(): IterableIterator<string>;
  /** Returns an iterator allowing to go through all values of the key/value pairs of this search parameter. */
  values(): IterableIterator<string>;
  forEach(
    callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
    thisArg?: any,
  ): void;
  /** Returns a string containing a query string suitable for use in a URL. Does not include the question mark. */
  toString(): string;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (
    init?: string[][] | Record<string, string> | string | URLSearchParams,
  ): URLSearchParams;
  toString(): string;
};

declare var URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  /** Not implemented yet */
  createObjectURL(obj: Blob): string;
  /** Not implemented yet */
  revokeObjectURL(url: string): void;
};

type TimerHandler = (...args: any[]) => void;

interface EventListener {
  (evt: Event): void;
}

interface EventListenerObject {
  handleEvent(object: Event): void;
}

declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};

interface FetchEvent extends Event {
  readonly request: Request;
  readonly url: string;

  waitUntil(promise: Promise<any>): void;
  respondWith(response: Response | Promise<Response>): void;
}

interface EventMap {
  fetch: FetchEvent;
  message: MessageEvent;
  messageerror: MessageEvent;
  // exit: Event;
}

interface AbortSignalEventMap {
  abort: Event<AbortSignal>;
}

interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

/** A signal object that allows you to communicate with a DOM request (such as a Fetch) and abort it if required via an AbortController object. */
interface AbortSignal extends EventTarget {
  /**
   * Returns true if this AbortSignal's AbortController has signaled to abort, and false otherwise.
   */
  readonly aborted: boolean;

  /**
   * The reason the signal aborted, or undefined if not aborted.
   */
  readonly reason: any;

  onabort: ((this: AbortSignal, ev: Event) => any) | null;
  addEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AbortSignal: {
  prototype: AbortSignal;
  new (): AbortSignal;
  abort(reason?: any): AbortSignal;
  /**
   * Create an AbortSignal which times out after milliseconds
   *
   * @param milliseconds the number of milliseconds to delay until {@link AbortSignal.prototype.signal()} is called
   *
   * @example
   *
   * ## Timeout a `fetch()` request
   *
   * ```ts
   * await fetch("https://example.com", {
   *    signal: AbortSignal.timeout(100)
   * })
   * ```
   */
  timeout(milliseconds: number): AbortSignal;
};

// type AlgorithmIdentifier = Algorithm | string;
// type BodyInit = ReadableStream | XMLHttpRequestBodyInit;
type BufferSource = TypedArray | DataView | ArrayBufferLike;
// type COSEAlgorithmIdentifier = number;
// type CSSNumberish = number;
// type CanvasImageSource =
//   | HTMLOrSVGImageElement
//   | HTMLVideoElement
//   | HTMLCanvasElement
//   | ImageBitmap;
type DOMHighResTimeStamp = number;
// type EpochTimeStamp = number;
type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

/**
 * Low-level JavaScriptCore API for accessing the native ES Module loader (not a Bun API)
 *
 * Before using this, be aware of a few things:
 *
 * **Using this incorrectly will crash your application**.
 *
 * This API may change any time JavaScriptCore is updated.
 *
 * Bun may rewrite ESM import specifiers to point to bundled code. This will
 * be confusing when using this API, as it will return a string like
 * "/node_modules.server.bun".
 *
 * Bun may inject additional imports into your code. This usually has a `bun:` prefix.
 */
declare var Loader: {
  /**
   * ESM module registry
   *
   * This lets you implement live reload in Bun. If you
   * delete a module specifier from this map, the next time it's imported, it
   * will be re-transpiled and loaded again.
   *
   * The keys are the module specifiers and the
   * values are metadata about the module.
   *
   * The keys are an implementation detail for Bun that will change between
   * versions.
   *
   * - Userland modules are an absolute file path
   * - Virtual modules have a `bun:` prefix or `node:` prefix
   * - JS polyfills start with `"/bun-vfs/"`. `"buffer"` is an example of a JS polyfill
   * - If you have a `node_modules.bun` file, many modules will point to that file
   *
   * Virtual modules and JS polyfills are embedded in bun's binary. They don't
   * point to anywhere in your local filesystem.
   */
  registry: Map<
    string,
    {
      key: string;
      /**
       * This refers to the state the ESM module is in
       *
       * TODO: make an enum for this number
       */
      state: number;
      fetch: Promise<any>;
      instantiate: Promise<any>;
      satisfy: Promise<any>;
      dependencies: Array<
        (typeof Loader)["registry"] extends Map<any, infer V> ? V : any
      >;
      /**
       * Your application will probably crash if you mess with this.
       */
      module: {
        dependenciesMap: (typeof Loader)["registry"];
      };
      linkError?: any;
      linkSucceeded: boolean;
      evaluated: boolean;
      then?: any;
      isAsync: boolean;
    }
  >;
  /**
   * For an already-evaluated module, return the dependencies as module specifiers
   *
   * This list is already sorted and uniqued.
   *
   * @example
   *
   * For this code:
   * ```js
   * // /foo.js
   * import classNames from 'classnames';
   * import React from 'react';
   * import {createElement} from 'react';
   * ```
   *
   * This would return:
   * ```js
   * Loader.dependencyKeysIfEvaluated("/foo.js")
   * ["bun:wrap", "/path/to/node_modules/classnames/index.js", "/path/to/node_modules/react/index.js"]
   * ```
   *
   * @param specifier - module specifier as it appears in transpiled source code
   *
   */
  dependencyKeysIfEvaluated: (specifier: string) => string[];
  /**
   * The function JavaScriptCore internally calls when you use an import statement.
   *
   * This may return a path to `node_modules.server.bun`, which will be confusing.
   *
   * Consider {@link Bun.resolve} or {@link ImportMeta.resolve}
   * instead.
   *
   * @param specifier - module specifier as it appears in transpiled source code
   * @param referrer - module specifier that is resolving this specifier
   */
  resolve: (specifier: string, referrer: string) => string;
};

/** This Streams API interface represents a readable stream of byte data. The Fetch API offers a concrete instance of a ReadableStream through the body property of a Response object. */
interface ReadableStream<R = any> {
  readonly locked: boolean;
  cancel(reason?: any): Promise<void>;
  getReader(): ReadableStreamDefaultReader<R>;
  pipeThrough<T>(
    transform: ReadableWritablePair<T, R>,
    options?: StreamPipeOptions,
  ): ReadableStream<T>;
  pipeTo(
    destination: WritableStream<R>,
    options?: StreamPipeOptions,
  ): Promise<void>;
  tee(): [ReadableStream<R>, ReadableStream<R>];
  [Symbol.asyncIterator](): AsyncIterableIterator<R>;
  values(options?: { preventCancel: boolean }): AsyncIterableIterator<R>;
}

declare var ReadableStream: {
  prototype: ReadableStream;
  new <R = any>(
    underlyingSource?: UnderlyingSource<R>,
    strategy?: QueuingStrategy<R>,
  ): ReadableStream<R>;
  new <R = any>(
    underlyingSource?: DirectUnderlyingSource<R>,
    strategy?: QueuingStrategy<R>,
  ): ReadableStream<R>;
};

interface QueuingStrategy<T = any> {
  highWaterMark?: number;
  size?: QueuingStrategySize<T>;
}

interface QueuingStrategyInit {
  /**
   * Creates a new ByteLengthQueuingStrategy with the provided high water mark.
   *
   * Note that the provided high water mark will not be validated ahead of time. Instead, if it is negative, NaN, or not a number, the resulting ByteLengthQueuingStrategy will cause the corresponding stream constructor to throw.
   */
  highWaterMark: number;
}

/** This Streams API interface provides a built-in byte length queuing strategy that can be used when constructing streams. */
interface ByteLengthQueuingStrategy extends QueuingStrategy<BufferSource> {
  readonly highWaterMark: number;
  readonly size: QueuingStrategySize<BufferSource>;
}

declare var ByteLengthQueuingStrategy: {
  prototype: ByteLengthQueuingStrategy;
  new (init: QueuingStrategyInit): ByteLengthQueuingStrategy;
};

interface ReadableStreamDefaultController<R = any> {
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk?: R): void;
  error(e?: any): void;
}

interface ReadableStreamDirectController {
  close(error?: Error): void;
  write(data: BufferSource | ArrayBuffer | string): number | Promise<number>;
  end(): number | Promise<number>;
  flush(): number | Promise<number>;
  start(): void;
}

declare var ReadableStreamDefaultController: {
  prototype: ReadableStreamDefaultController;
  new (): ReadableStreamDefaultController;
};

interface ReadableStreamDefaultReader<R = any>
  extends ReadableStreamGenericReader {
  read(): Promise<ReadableStreamDefaultReadResult<R>>;
  /** Only available in Bun. If there are multiple chunks in the queue, this will return all of them at the same time. */
  readMany(): Promise<ReadableStreamDefaultReadManyResult<R>>;
  releaseLock(): void;
}

declare var ReadableStreamDefaultReader: {
  prototype: ReadableStreamDefaultReader;
  new <R = any>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R>;
};

interface ReadableStreamGenericReader {
  readonly closed: Promise<undefined>;
  cancel(reason?: any): Promise<void>;
}

interface ReadableStreamDefaultReadDoneResult {
  done: true;
  value?: undefined;
}

interface ReadableStreamDefaultReadValueResult<T> {
  done: false;
  value: T;
}

interface ReadableWritablePair<R = any, W = any> {
  readable: ReadableStream<R>;
  /**
   * Provides a convenient, chainable way of piping this readable stream through a transform stream (or any other { writable, readable } pair). It simply pipes the stream into the writable side of the supplied pair, and returns the readable side for further use.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   */
  writable: WritableStream<W>;
}

/** This Streams API interface provides a standard abstraction for writing streaming data to a destination, known as a sink. This object comes with built-in backpressure and queuing. */
interface WritableStream<W = any> {
  readonly locked: boolean;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  getWriter(): WritableStreamDefaultWriter<W>;
}

declare var WritableStream: {
  prototype: WritableStream;
  new <W = any>(
    underlyingSink?: UnderlyingSink<W>,
    strategy?: QueuingStrategy<W>,
  ): WritableStream<W>;
};

/** This Streams API interface represents a controller allowing control of a WritableStream's state. When constructing a WritableStream, the underlying sink is given a corresponding WritableStreamDefaultController instance to manipulate. */
interface WritableStreamDefaultController {
  error(e?: any): void;
}

declare var WritableStreamDefaultController: {
  prototype: WritableStreamDefaultController;
  new (): WritableStreamDefaultController;
};

/** This Streams API interface is the object returned by WritableStream.getWriter() and once created locks the < writer to the WritableStream ensuring that no other streams can write to the underlying sink. */
interface WritableStreamDefaultWriter<W = any> {
  readonly closed: Promise<undefined>;
  readonly desiredSize: number | null;
  readonly ready: Promise<undefined>;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
  write(chunk?: W): Promise<void>;
}

declare var WritableStreamDefaultWriter: {
  prototype: WritableStreamDefaultWriter;
  new <W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
};

interface ReadWriteStream extends ReadableStream, WritableStream {}

interface TransformerFlushCallback<O> {
  (controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
}

interface TransformerStartCallback<O> {
  (controller: TransformStreamDefaultController<O>): any;
}

interface TransformerTransformCallback<I, O> {
  (
    chunk: I,
    controller: TransformStreamDefaultController<O>,
  ): void | PromiseLike<void>;
}

interface UnderlyingSinkAbortCallback {
  (reason?: any): void | PromiseLike<void>;
}

interface UnderlyingSinkCloseCallback {
  (): void | PromiseLike<void>;
}

interface UnderlyingSinkStartCallback {
  (controller: WritableStreamDefaultController): any;
}

interface UnderlyingSinkWriteCallback<W> {
  (
    chunk: W,
    controller: WritableStreamDefaultController,
  ): void | PromiseLike<void>;
}

interface UnderlyingSourceCancelCallback {
  (reason?: any): void | PromiseLike<void>;
}

interface UnderlyingSink<W = any> {
  abort?: UnderlyingSinkAbortCallback;
  close?: UnderlyingSinkCloseCallback;
  start?: UnderlyingSinkStartCallback;
  type?: undefined | "default" | "bytes";
  write?: UnderlyingSinkWriteCallback<W>;
}

interface UnderlyingSource<R = any> {
  cancel?: UnderlyingSourceCancelCallback;
  pull?: UnderlyingSourcePullCallback<R>;
  start?: UnderlyingSourceStartCallback<R>;
  /**
   * Mode "bytes" is not currently supported.
   */
  type?: undefined;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface DirectUnderlyingSource<R = any> {
  cancel?: UnderlyingSourceCancelCallback;
  pull: (
    controller: ReadableStreamDirectController,
  ) => void | PromiseLike<void>;
  type: "direct";
}

interface UnderlyingSourcePullCallback<R> {
  (controller: ReadableStreamController<R>): void | PromiseLike<void>;
}

interface UnderlyingSourceStartCallback<R> {
  (controller: ReadableStreamController<R>): any;
}

interface GenericTransformStream {
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
}

interface TransformStream<I = any, O = any> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
}

declare var TransformStream: {
  prototype: TransformStream;
  new <I = any, O = any>(
    transformer?: Transformer<I, O>,
    writableStrategy?: QueuingStrategy<I>,
    readableStrategy?: QueuingStrategy<O>,
  ): TransformStream<I, O>;
};

interface TransformStreamDefaultController<O = any> {
  readonly desiredSize: number | null;
  enqueue(chunk?: O): void;
  error(reason?: any): void;
  terminate(): void;
}

declare var TransformStreamDefaultController: {
  prototype: TransformStreamDefaultController;
  new (): TransformStreamDefaultController;
};

interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  /**
   * Pipes this readable stream to a given writable stream destination. The way in which the piping process behaves under various error conditions can be customized with a number of passed options. It returns a promise that fulfills when the piping process completes successfully, or rejects if any errors were encountered.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   *
   * Errors and closures of the source and destination streams propagate as follows:
   *
   * An error in this source readable stream will abort destination, unless preventAbort is truthy. The returned promise will be rejected with the source's error, or with any error that occurs during aborting the destination.
   *
   * An error in destination will cancel this source readable stream, unless preventCancel is truthy. The returned promise will be rejected with the destination's error, or with any error that occurs during canceling the source.
   *
   * When this source readable stream closes, destination will be closed, unless preventClose is truthy. The returned promise will be fulfilled once this process completes, unless an error is encountered while closing the destination, in which case it will be rejected with that error.
   *
   * If destination starts out closed or closing, this source readable stream will be canceled, unless preventCancel is true. The returned promise will be rejected with an error indicating piping to a closed stream failed, or with any error that occurs during canceling the source.
   *
   * The signal option can be set to an AbortSignal to allow aborting an ongoing pipe operation via the corresponding AbortController. In this case, this source readable stream will be canceled, and destination aborted, unless the respective options preventCancel or preventAbort are set.
   */
  preventClose?: boolean;
  signal?: AbortSignal;
}

/** This Streams API interface provides a built-in byte length queuing strategy that can be used when constructing streams. */
interface CountQueuingStrategy extends QueuingStrategy {
  readonly highWaterMark: number;
  readonly size: QueuingStrategySize;
}

declare var CountQueuingStrategy: {
  prototype: CountQueuingStrategy;
  new (init: QueuingStrategyInit): CountQueuingStrategy;
};

interface QueuingStrategySize<T = any> {
  (chunk?: T): number;
}

interface Transformer<I = any, O = any> {
  flush?: TransformerFlushCallback<O>;
  readableType?: undefined;
  start?: TransformerStartCallback<O>;
  transform?: TransformerTransformCallback<I, O>;
  writableType?: undefined;
}

interface Dict<T> {
  [key: string]: T | undefined;
}

interface ReadOnlyDict<T> {
  readonly [key: string]: T | undefined;
}

interface ErrnoException extends Error {
  errno?: number | undefined;
  code?: string | undefined;
  path?: string | undefined;
  syscall?: string | undefined;
}

/** An abnormal event (called an exception) which occurs as a result of calling a method or accessing a property of a web API. */
interface DOMException extends Error {
  /** @deprecated */
  readonly code: number;
  readonly message: string;
  readonly name: string;
  readonly ABORT_ERR: number;
  readonly DATA_CLONE_ERR: number;
  readonly DOMSTRING_SIZE_ERR: number;
  readonly HIERARCHY_REQUEST_ERR: number;
  readonly INDEX_SIZE_ERR: number;
  readonly INUSE_ATTRIBUTE_ERR: number;
  readonly INVALID_ACCESS_ERR: number;
  readonly INVALID_CHARACTER_ERR: number;
  readonly INVALID_MODIFICATION_ERR: number;
  readonly INVALID_NODE_TYPE_ERR: number;
  readonly INVALID_STATE_ERR: number;
  readonly NAMESPACE_ERR: number;
  readonly NETWORK_ERR: number;
  readonly NOT_FOUND_ERR: number;
  readonly NOT_SUPPORTED_ERR: number;
  readonly NO_DATA_ALLOWED_ERR: number;
  readonly NO_MODIFICATION_ALLOWED_ERR: number;
  readonly QUOTA_EXCEEDED_ERR: number;
  readonly SECURITY_ERR: number;
  readonly SYNTAX_ERR: number;
  readonly TIMEOUT_ERR: number;
  readonly TYPE_MISMATCH_ERR: number;
  readonly URL_MISMATCH_ERR: number;
  readonly VALIDATION_ERR: number;
  readonly WRONG_DOCUMENT_ERR: number;
}
declare var DOMException: {
  prototype: DOMException;
  new (message?: string, name?: string): DOMException;
};

declare function alert(message?: string): void;
declare function confirm(message?: string): boolean;
declare function prompt(message?: string, _default?: string): string | null;

/*

 Web Crypto API

*/

type KeyFormat = "jwk" | "pkcs8" | "raw" | "spki";
type KeyType = "private" | "public" | "secret";
type KeyUsage =
  | "decrypt"
  | "deriveBits"
  | "deriveKey"
  | "encrypt"
  | "sign"
  | "unwrapKey"
  | "verify"
  | "wrapKey";
type HashAlgorithmIdentifier = AlgorithmIdentifier;
type NamedCurve = string;

type BigInteger = Uint8Array;

interface KeyAlgorithm {
  name: string;
}

interface Algorithm {
  name: string;
}

interface AesCbcParams extends Algorithm {
  iv: BufferSource;
}

interface AesCtrParams extends Algorithm {
  counter: BufferSource;
  length: number;
}

interface AesDerivedKeyParams extends Algorithm {
  length: number;
}

interface AesGcmParams extends Algorithm {
  additionalData?: BufferSource;
  iv: BufferSource;
  tagLength?: number;
}

interface AesKeyAlgorithm extends KeyAlgorithm {
  length: number;
}

interface AesKeyGenParams extends Algorithm {
  length: number;
}

interface EcKeyAlgorithm extends KeyAlgorithm {
  namedCurve: NamedCurve;
}

interface EcKeyGenParams extends Algorithm {
  namedCurve: NamedCurve;
}

interface EcKeyImportParams extends Algorithm {
  namedCurve: NamedCurve;
}

interface EcdhKeyDeriveParams extends Algorithm {
  public: CryptoKey;
}

interface EcdsaParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
}

interface JsonWebKey {
  alg?: string;
  crv?: string;
  d?: string;
  dp?: string;
  dq?: string;
  e?: string;
  ext?: boolean;
  k?: string;
  key_ops?: string[];
  kty?: string;
  n?: string;
  oth?: RsaOtherPrimesInfo[];
  p?: string;
  q?: string;
  qi?: string;
  use?: string;
  x?: string;
  y?: string;
}

interface HkdfParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
  info: BufferSource;
  salt: BufferSource;
}

interface HmacImportParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
  length?: number;
}

interface HmacKeyAlgorithm extends KeyAlgorithm {
  hash: KeyAlgorithm;
  length: number;
}

interface HmacKeyGenParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
  length?: number;
}

interface Pbkdf2Params extends Algorithm {
  hash: HashAlgorithmIdentifier;
  iterations: number;
  salt: BufferSource;
}

interface RsaHashedImportParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
}

interface RsaHashedKeyAlgorithm extends RsaKeyAlgorithm {
  hash: KeyAlgorithm;
}

interface RsaHashedKeyGenParams extends RsaKeyGenParams {
  hash: HashAlgorithmIdentifier;
}

interface RsaKeyAlgorithm extends KeyAlgorithm {
  modulusLength: number;
  publicExponent: BigInteger;
}

interface RsaKeyGenParams extends Algorithm {
  modulusLength: number;
  publicExponent: BigInteger;
}

interface RsaOaepParams extends Algorithm {
  label?: BufferSource;
}

interface RsaOtherPrimesInfo {
  d?: string;
  r?: string;
  t?: string;
}

interface CryptoKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

type AlgorithmIdentifier = Algorithm | string;

/**
 * This Web Crypto API interface provides a number of low-level cryptographic functions. It is accessed via the Crypto.subtle properties available in a window context (via Window.crypto).
 */
interface SubtleCrypto {
  decrypt(
    algorithm:
      | AlgorithmIdentifier
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  deriveBits(
    algorithm:
      | AlgorithmIdentifier
      | EcdhKeyDeriveParams
      | HkdfParams
      | Pbkdf2Params,
    baseKey: CryptoKey,
    length: number,
  ): Promise<ArrayBuffer>;
  deriveKey(
    algorithm:
      | AlgorithmIdentifier
      | EcdhKeyDeriveParams
      | HkdfParams
      | Pbkdf2Params,
    baseKey: CryptoKey,
    derivedKeyType:
      | AlgorithmIdentifier
      | AesDerivedKeyParams
      | HmacImportParams
      | HkdfParams
      | Pbkdf2Params,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  digest(
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  encrypt(
    algorithm:
      | AlgorithmIdentifier
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  exportKey(format: "jwk", key: CryptoKey): Promise<JsonWebKey>;
  exportKey(
    format: Exclude<KeyFormat, "jwk">,
    key: CryptoKey,
  ): Promise<ArrayBuffer>;
  generateKey(
    algorithm: RsaHashedKeyGenParams | EcKeyGenParams,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: AesKeyGenParams | HmacKeyGenParams | Pbkdf2Params,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  generateKey(
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey>;
  importKey(
    format: "jwk",
    keyData: JsonWebKey,
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  importKey(
    format: Exclude<KeyFormat, "jwk">,
    keyData: BufferSource,
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  sign(
    algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  unwrapKey(
    format: KeyFormat,
    wrappedKey: BufferSource,
    unwrappingKey: CryptoKey,
    unwrapAlgorithm:
      | AlgorithmIdentifier
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams,
    unwrappedKeyAlgorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  verify(
    algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean>;
  wrapKey(
    format: KeyFormat,
    key: CryptoKey,
    wrappingKey: CryptoKey,
    wrapAlgorithm:
      | AlgorithmIdentifier
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams,
  ): Promise<ArrayBuffer>;
}

declare var SubtleCrypto: {
  prototype: SubtleCrypto;
  new (): SubtleCrypto;
};

interface RsaPssParams extends Algorithm {
  saltLength: number;
}

/**
 * The CryptoKey dictionary of the Web Crypto API represents a cryptographic key.
 */
interface CryptoKey {
  readonly algorithm: KeyAlgorithm;
  readonly extractable: boolean;
  readonly type: KeyType;
  readonly usages: KeyUsage[];
}

declare var CryptoKey: {
  prototype: CryptoKey;
  new (): CryptoKey;
};

interface Position {
  lineText: string;
  file: string;
  namespace: string;
  line: number;
  column: number;
  length: number;
  offset: number;
}

declare class ResolveMessage {
  readonly name: "ResolveMessage";
  readonly position: Position | null;
  readonly code: string;
  readonly message: string;
  readonly referrer: string;
  readonly specifier: string;
  readonly importKind:
    | "entry_point"
    | "stmt"
    | "require"
    | "import"
    | "dynamic"
    | "require_resolve"
    | "at"
    | "at_conditional"
    | "url"
    | "internal";
  readonly level: "error" | "warning" | "info" | "debug" | "verbose";

  toString(): string;
}

declare class BuildMessage {
  readonly name: "BuildMessage";
  readonly position: Position | null;
  readonly message: string;
  readonly level: "error" | "warning" | "info" | "debug" | "verbose";
}

/**
 * @deprecated Renamed to `BuildMessage`
 */
declare var BuildError: typeof BuildMessage;

/**
 * @deprecated Renamed to `ResolveMessage`
 */
declare var ResolveError: typeof ResolveMessage;

// Declare "static" methods in Error
interface ErrorConstructor {
  /** Create .stack property on a target object */
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;

  /**
   * Optional override for formatting stack traces
   *
   * @see https://v8.dev/docs/stack-trace-api#customizing-stack-traces
   */
  prepareStackTrace?:
    | ((err: Error, stackTraces: CallSite[]) => any)
    | undefined;

  stackTraceLimit: number;
}

interface CallSite {
  /**
   * Value of "this"
   */
  getThis(): unknown;

  /**
   * Type of "this" as a string.
   * This is the name of the function stored in the constructor field of
   * "this", if available.  Otherwise the object's [[Class]] internal
   * property.
   */
  getTypeName(): string | null;

  /**
   * Current function
   */
  getFunction(): Function | undefined;

  /**
   * Name of the current function, typically its name property.
   * If a name property is not available an attempt will be made to try
   * to infer a name from the function's context.
   */
  getFunctionName(): string | null;

  /**
   * Name of the property [of "this" or one of its prototypes] that holds
   * the current function
   */
  getMethodName(): string | null;

  /**
   * Name of the script [if this function was defined in a script]
   */
  getFileName(): string | null;

  /**
   * Current line number [if this function was defined in a script]
   */
  getLineNumber(): number | null;

  /**
   * Current column number [if this function was defined in a script]
   */
  getColumnNumber(): number | null;

  /**
   * A call site object representing the location where eval was called
   * [if this function was created using a call to eval]
   */
  getEvalOrigin(): string | undefined;

  /**
   * Is this a toplevel invocation, that is, is "this" the global object?
   */
  isToplevel(): boolean;

  /**
   * Does this call take place in code defined by a call to eval?
   */
  isEval(): boolean;

  /**
   * Is this call in native code?
   */
  isNative(): boolean;

  /**
   * Is this a constructor call?
   */
  isConstructor(): boolean;
}

interface ArrayBufferConstructor {
  new (params: { byteLength: number; maxByteLength?: number }): ArrayBuffer;
}
interface ArrayBuffer {
  /**
   * Read-only. The length of the ArrayBuffer (in bytes).
   */
  readonly byteLength: number;
  /**
   * Resize an ArrayBuffer in-place.
   */
  resize(byteLength: number): ArrayBuffer;

  /**
   * Returns a section of an ArrayBuffer.
   */
  slice(begin: number, end?: number): ArrayBuffer;
  readonly [Symbol.toStringTag]: string;
}

interface SharedArrayBuffer {
  /**
   * Grow the SharedArrayBuffer in-place.
   */
  grow(size: number): SharedArrayBuffer;
}

declare namespace WebAssembly {
  interface CompileError extends Error {}

  var CompileError: {
    prototype: CompileError;
    new (message?: string): CompileError;
    (message?: string): CompileError;
  };

  interface Global {
    value: any;
    valueOf(): any;
  }

  var Global: {
    prototype: Global;
    new (descriptor: GlobalDescriptor, v?: any): Global;
  };

  interface Instance {
    readonly exports: Exports;
  }

  var Instance: {
    prototype: Instance;
    new (module: Module, importObject?: Imports): Instance;
  };

  interface LinkError extends Error {}

  var LinkError: {
    prototype: LinkError;
    new (message?: string): LinkError;
    (message?: string): LinkError;
  };

  interface Memory {
    readonly buffer: ArrayBuffer;
    grow(delta: number): number;
  }

  var Memory: {
    prototype: Memory;
    new (descriptor: MemoryDescriptor): Memory;
  };

  interface Module {}

  var Module: {
    prototype: Module;
    new (bytes: BufferSource): Module;
    customSections(moduleObject: Module, sectionName: string): ArrayBuffer[];
    exports(moduleObject: Module): ModuleExportDescriptor[];
    imports(moduleObject: Module): ModuleImportDescriptor[];
  };

  interface RuntimeError extends Error {}

  var RuntimeError: {
    prototype: RuntimeError;
    new (message?: string): RuntimeError;
    (message?: string): RuntimeError;
  };

  interface Table {
    readonly length: number;
    get(index: number): any;
    grow(delta: number, value?: any): number;
    set(index: number, value?: any): void;
  }

  var Table: {
    prototype: Table;
    new (descriptor: TableDescriptor, value?: any): Table;
  };

  interface GlobalDescriptor {
    mutable?: boolean;
    value: ValueType;
  }

  interface MemoryDescriptor {
    initial: number;
    maximum?: number;
    shared?: boolean;
  }

  interface ModuleExportDescriptor {
    kind: ImportExportKind;
    name: string;
  }

  interface ModuleImportDescriptor {
    kind: ImportExportKind;
    module: string;
    name: string;
  }

  interface TableDescriptor {
    element: TableKind;
    initial: number;
    maximum?: number;
  }

  interface WebAssemblyInstantiatedSource {
    instance: Instance;
    module: Module;
  }

  type ImportExportKind = "function" | "global" | "memory" | "table";
  type TableKind = "anyfunc" | "externref";
  type ValueType =
    | "anyfunc"
    | "externref"
    | "f32"
    | "f64"
    | "i32"
    | "i64"
    | "v128";
  type ExportValue = Function | Global | Memory | Table;
  type Exports = Record<string, ExportValue>;
  type ImportValue = ExportValue | number;
  type Imports = Record<string, ModuleImports>;
  type ModuleImports = Record<string, ImportValue>;
  function compile(bytes: BufferSource): Promise<Module>;
  // function compileStreaming(source: Response | PromiseLike<Response>): Promise<Module>;
  function instantiate(
    bytes: BufferSource,
    importObject?: Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function instantiate(
    moduleObject: Module,
    importObject?: Imports,
  ): Promise<Instance>;
  // function instantiateStreaming(
  //   source: Response | PromiseLike<Response>,
  //   importObject?: Imports,
  // ): Promise<WebAssemblyInstantiatedSource>;
  function validate(bytes: BufferSource): boolean;
}

interface NodeModule {
  exports: any;
}

declare var module: NodeModule;

// Same as module.exports
declare var exports: any;
declare var global: typeof globalThis;

declare module "*.txt" {
  var text: string;
  export = text;
}

declare module "*.toml" {
  var contents: unknown;
  export = contents;
}

interface EventSourceEventMap {
  error: Event;
  message: MessageEvent;
  open: Event;
}

/**
 * Post a message to the parent thread.
 *
 * Only useful in a worker thread; calling this from the main thread does nothing.
 */
declare function postMessage(message: any, transfer?: Transferable[]): void;

interface EventSource extends EventTarget {
  onerror: ((this: EventSource, ev: ErrorEvent) => any) | null;
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null;
  onopen: ((this: EventSource, ev: Event) => any) | null;
  /** Returns the state of this EventSource object's connection. It can have the values described below. */
  readonly readyState: number;
  /** Returns the URL providing the event stream. */
  readonly url: string;
  /** Returns true if the credentials mode for connection requests to the URL providing the event stream is set to "include", and false otherwise.
   *
   * Not supported in Bun
   *
   */
  readonly withCredentials: boolean;
  /** Aborts any instances of the fetch algorithm started for this EventSource object, and sets the readyState attribute to CLOSED. */
  close(): void;
  readonly CLOSED: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
  addEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;

  /**
   * Keep the event loop alive while connection is open or reconnecting
   *
   * Not available in browsers
   */
  ref(): void;

  /**
   * Do not keep the event loop alive while connection is open or reconnecting
   *
   * Not available in browsers
   */
  unref(): void;
}

declare var EventSource: {
  prototype: EventSource;
  new (url: string | URL, eventSourceInitDict?: EventSourceInit): EventSource;
  readonly CLOSED: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
};

interface PromiseConstructor {
  /**
   * Create a deferred promise, with exposed `resolve` and `reject` methods which can be called
   * separately.
   *
   * This is useful when you want to return a Promise and have code outside the Promise
   * resolve or reject it.
   *
   * ## Example
   * ```ts
   * const { promise, resolve, reject } = Promise.withResolvers();
   *
   * setTimeout(() => {
   *  resolve("Hello world!");
   * }, 1000);
   *
   * await promise; // "Hello world!"
   * ```
   *
   * `Promise.withResolvers()` is a [stage3 proposal](https://github.com/tc39/proposal-promise-with-resolvers).
   */
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value?: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  };
}
