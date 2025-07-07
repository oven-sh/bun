/**
 * Bun.js runtime APIs
 *
 * @example
 *
 * ```js
 * import {file} from 'bun';
 *
 * // Log the file to the console
 * const input = await file('/path/to/file.txt').text();
 * console.log(input);
 * ```
 *
 * This module aliases `globalThis.Bun`.
 */
declare module "bun" {
  type DistributedOmit<T, K extends PropertyKey> = T extends T ? Omit<T, K> : never;
  type PathLike = string | NodeJS.TypedArray | ArrayBufferLike | URL;
  type ArrayBufferView<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> =
    | NodeJS.TypedArray<TArrayBuffer>
    | DataView<TArrayBuffer>;
  type BufferSource = NodeJS.TypedArray | DataView | ArrayBufferLike;
  type StringOrBuffer = string | NodeJS.TypedArray | ArrayBufferLike;
  type XMLHttpRequestBodyInit = Blob | BufferSource | string | FormData | Iterable<Uint8Array>;
  type ReadableStreamController<T> = ReadableStreamDefaultController<T>;
  type ReadableStreamDefaultReadResult<T> =
    | ReadableStreamDefaultReadValueResult<T>
    | ReadableStreamDefaultReadDoneResult;
  type ReadableStreamReader<T> = ReadableStreamDefaultReader<T>;
  type Transferable = ArrayBuffer | MessagePort;
  type MessageEventSource = Bun.__internal.UseLibDomIfAvailable<"MessageEventSource", undefined>;
  type Encoding = "utf-8" | "windows-1252" | "utf-16";
  type UncaughtExceptionOrigin = "uncaughtException" | "unhandledRejection";
  type MultipleResolveType = "resolve" | "reject";
  type BeforeExitListener = (code: number) => void;
  type DisconnectListener = () => void;
  type ExitListener = (code: number) => void;
  type RejectionHandledListener = (promise: Promise<unknown>) => void;
  type FormDataEntryValue = File | string;
  type WarningListener = (warning: Error) => void;
  type MessageListener = (message: unknown, sendHandle: unknown) => void;
  type SignalsListener = (signal: NodeJS.Signals) => void;
  type BlobPart = string | Blob | BufferSource;
  type TimerHandler = (...args: any[]) => void;
  type DOMHighResTimeStamp = number;
  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
  type BlobOrStringOrBuffer = string | NodeJS.TypedArray | ArrayBufferLike | Blob;
  type MaybePromise<T> = T | Promise<T>;

  namespace __internal {
    type LibDomIsLoaded = typeof globalThis extends { onabort: any } ? true : false;

    /**
     * Helper type for avoiding conflicts in types.
     *
     * Uses the lib.dom.d.ts definition if it exists, otherwise defines it locally.
     *
     * This is to avoid type conflicts between lib.dom.d.ts and \@types/bun.
     *
     * Unfortunately some symbols cannot be defined when both Bun types and lib.dom.d.ts types are loaded,
     * and since we can't redeclare the symbol in a way that satisfies both, we need to fallback
     * to the type that lib.dom.d.ts provides.
     */
    type UseLibDomIfAvailable<GlobalThisKeyName extends PropertyKey, Otherwise> =
      // `onabort` is defined in lib.dom.d.ts, so we can check to see if lib dom is loaded by checking if `onabort` is defined
      LibDomIsLoaded extends true
        ? typeof globalThis extends { [K in GlobalThisKeyName]: infer T } // if it is loaded, infer it from `globalThis` and use that value
          ? T
          : Otherwise // Not defined in lib dom (or anywhere else), so no conflict. We can safely use our own definition
        : Otherwise; // Lib dom not loaded anyway, so no conflict. We can safely use our own definition
  }

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
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

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type Architecture = "arm" | "arm64" | "ia32" | "mips" | "mipsel" | "ppc" | "ppc64" | "s390" | "s390x" | "x64";

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type UncaughtExceptionListener = (error: Error, origin: UncaughtExceptionOrigin) => void;

  /**
   * Most of the time the unhandledRejection will be an Error, but this should not be relied upon
   * as *anything* can be thrown/rejected, it is therefore unsafe to assume that the value is an Error.
   *
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type UnhandledRejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type MultipleResolveListener = (type: MultipleResolveType, promise: Promise<unknown>, value: unknown) => void;

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
    source?: Bun.MessageEventSource | null;
  }

  interface EventInit {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }

  interface EventListenerOptions {
    capture?: boolean;
  }

  interface CustomEventInit<T = any> extends Bun.EventInit {
    detail?: T;
  }

  /** A message received by a target object. */
  interface BunMessageEvent<T = any> extends Event {
    /** Returns the data of the message. */
    readonly data: T;
    /** Returns the last event ID string, for server-sent events. */
    readonly lastEventId: string;
    /** Returns the origin of the message, for server-sent events and cross-document messaging. */
    readonly origin: string;
    /** Returns the MessagePort array sent with the message, for cross-document messaging and channel messaging. */
    readonly ports: readonly MessagePort[]; // ReadonlyArray<typeof import("worker_threads").MessagePort["prototype"]>;
    readonly source: Bun.MessageEventSource | null;
  }

  type MessageEvent<T = any> = Bun.__internal.UseLibDomIfAvailable<"MessageEvent", BunMessageEvent<T>>;

  interface ReadableStreamDefaultReadManyResult<T> {
    done: boolean;
    /** Number of bytes */
    size: number;
    value: T[];
  }

  interface EventSourceEventMap {
    error: Event;
    message: MessageEvent;
    open: Event;
  }

  interface AddEventListenerOptions extends EventListenerOptions {
    /** When `true`, the listener is automatically removed when it is first invoked. Default: `false`. */
    once?: boolean;
    /** When `true`, serves as a hint that the listener will not call the `Event` object's `preventDefault()` method. Default: false. */
    passive?: boolean;
    signal?: AbortSignal;
  }

  interface EventListener {
    (evt: Event): void;
  }

  interface EventListenerObject {
    handleEvent(object: Event): void;
  }

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

  interface StructuredSerializeOptions {
    transfer?: Bun.Transferable[];
  }

  interface EventSource extends EventTarget {
    new (url: string | URL, eventSourceInitDict?: EventSourceInit): EventSource;

    onerror: ((this: EventSource, ev: Event) => any) | null;
    onmessage: ((this: EventSource, ev: MessageEvent) => any) | null;
    onopen: ((this: EventSource, ev: Event) => any) | null;
    /** Returns the state of this EventSource object's connection. It can have the values described below. */
    readonly readyState: number;
    /** Returns the URL providing the event stream. */
    readonly url: string;
    /** Returns true if the credentials mode for connection requests to the URL providing the event stream is set to "include", and false otherwise.
     *
     * Not supported in Bun
     */
    readonly withCredentials: boolean;
    /** Aborts any instances of the fetch algorithm started for this EventSource object, and sets the readyState attribute to CLOSED. */
    close(): void;
    readonly CLOSED: 2;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
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

  interface TransformerFlushCallback<O> {
    (controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
  }

  interface TransformerStartCallback<O> {
    (controller: TransformStreamDefaultController<O>): any;
  }

  interface TransformerTransformCallback<I, O> {
    (chunk: I, controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
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
    (chunk: W, controller: WritableStreamDefaultController): void | PromiseLike<void>;
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

  interface DirectUnderlyingSource<R = any> {
    cancel?: UnderlyingSourceCancelCallback;
    pull: (controller: ReadableStreamDirectController) => void | PromiseLike<void>;
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

  interface AbstractWorkerEventMap {
    error: ErrorEvent;
  }

  interface WorkerEventMap extends AbstractWorkerEventMap {
    message: MessageEvent;
    messageerror: MessageEvent;
    close: CloseEvent;
    open: Event;
  }

  type WorkerType = "classic" | "module";

  /**
   * This type-only interface is identical at runtime to {@link ReadableStream},
   * and exists to document types that do not exist yet in libdom.
   */
  interface BunReadableStream<T = any> extends ReadableStream<T> {
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
    json(): Promise<any>;
    blob(): Promise<Blob>;
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
    type?: Bun.WorkerType | undefined;

    /**
     * List of arguments which would be stringified and appended to
     * `Bun.argv` / `process.argv` in the worker. This is mostly similar to the `data`
     * but the values will be available on the global `Bun.argv` as if they
     * were passed as CLI options to the script.
     */
    argv?: any[] | undefined;

    /** If `true` and the first argument is a string, interpret the first argument to the constructor as a script that is executed once the worker is online. */
    // eval?: boolean | undefined;

    /**
     * If set, specifies the initial value of process.env inside the Worker thread. As a special value, worker.SHARE_ENV may be used to specify that the parent thread and the child thread should share their environment variables; in that case, changes to one thread's process.env object affect the other thread as well. Default: process.env.
     */
    env?: Record<string, string> | (typeof import("node:worker_threads"))["SHARE_ENV"] | undefined;

    /**
     * In Bun, this does nothing.
     */
    credentials?: import("undici-types").RequestCredentials | undefined;

    /**
     * @default true
     */
    // trackUnmanagedFds?: boolean;
    // resourceLimits?: import("worker_threads").ResourceLimits;

    /**
     * An array of module specifiers to preload in the worker.
     *
     * These modules load before the worker's entry point is executed.
     *
     * Equivalent to passing the `--preload` CLI argument, but only for this Worker.
     */
    preload?: string[] | string | undefined;
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

    /**
     * An integer identifier for the referenced thread. Inside the worker thread,
     * it is available as `require('node:worker_threads').threadId`.
     * This value is unique for each `Worker` instance inside a single process.
     * @since v10.5.0
     */
    threadId: number;
  }

  interface Env {
    NODE_ENV?: string;
    /**
     * Can be used to change the default timezone at runtime
     */
    TZ?: string;
  }

  /**
   * The environment variables of the process
   *
   * Defaults to `process.env` as it was when the current Bun process launched.
   *
   * Changes to `process.env` at runtime won't automatically be reflected in the default value. For that, you can pass `process.env` explicitly.
   */
  const env: Env & NodeJS.ProcessEnv & ImportMetaEnv;

  /**
   * The raw arguments passed to the process, including flags passed to Bun. If you want to easily read flags passed to your script, consider using `process.argv` instead.
   */
  const argv: string[];

  interface WhichOptions {
    /**
     * Overrides the PATH environment variable
     */
    PATH?: string;

    /**
     * When given a relative path, use this path to join it.
     */
    cwd?: string;
  }

  /**
   * Find the path to an executable, similar to typing which in your terminal. Reads the `PATH` environment variable unless overridden with `options.PATH`.
   *
   * @category Utilities
   *
   * @param command The name of the executable or script to find
   * @param options Options for the search
   */
  function which(command: string, options?: WhichOptions): string | null;

  interface StringWidthOptions {
    /**
     * If `true`, count ANSI escape codes as part of the string width. If `false`, ANSI escape codes are ignored when calculating the string width.
     *
     * @default false
     */
    countAnsiEscapeCodes?: boolean;

    /**
     * When it's ambiugous and `true`, count emoji as 1 characters wide. If `false`, emoji are counted as 2 character wide.
     *
     * @default true
     */
    ambiguousIsNarrow?: boolean;
  }

  /**
   * Get the column count of a string as it would be displayed in a terminal.
   * Supports ANSI escape codes, emoji, and wide characters.
   *
   * This is useful for:
   * - Aligning text in a terminal
   * - Quickly checking if a string contains ANSI escape codes
   * - Measuring the width of a string in a terminal
   *
   * This API is designed to match the popular "string-width" package, so that
   * existing code can be easily ported to Bun and vice versa.
   *
   * @returns The width of the string in columns
   *
   * @example
   * ```ts
   * import { stringWidth } from "bun";
   *
   * console.log(stringWidth("abc")); // 3
   * console.log(stringWidth("👩‍👩‍👧‍👦")); // 1
   * console.log(stringWidth("\u001b[31mhello\u001b[39m")); // 5
   * console.log(stringWidth("\u001b[31mhello\u001b[39m", { countAnsiEscapeCodes: false })); // 5
   * console.log(stringWidth("\u001b[31mhello\u001b[39m", { countAnsiEscapeCodes: true })); // 13
   * ```
   */
  function stringWidth(
    /**
     * The string to measure
     */
    input: string,
    options?: StringWidthOptions,
  ): number;

  /**
   * TOML related APIs
   */
  namespace TOML {
    /**
     * Parse a TOML string into a JavaScript object.
     *
     * @category Utilities
     *
     * @param input The TOML string to parse
     * @returns A JavaScript object
     */
    export function parse(input: string): object;
  }

  /**
   * Synchronously resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveMessage`
   */
  function resolveSync(moduleId: string, parent: string): string;

  /**
   * Resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveMessage`
   *
   * For now, use the sync version. There is zero performance benefit to using this async version. It exists for future-proofing.
   */
  function resolve(moduleId: string, parent: string): Promise<string>;

  /**
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file. If `destination`'s directory does not exist, it will be created by default.
   *
   * @category File System
   *
   * @param destination The file or file path to write to
   * @param input The data to copy into `destination`.
   * @param options Options for the write
   *
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destination: BunFile | S3File | PathLike,
    input: Blob | NodeJS.TypedArray | ArrayBufferLike | string | BlobPart[],
    options?: {
      /**
       * If writing to a PathLike, set the permissions of the file.
       */
      mode?: number;
      /**
       * If `true`, create the parent directory if it doesn't exist. By default, this is `true`.
       *
       * If `false`, this will throw an error if the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  /**
   * Persist a {@link Response} body to disk.
   *
   * @param destination The file to write to. If the file doesn't exist,
   * it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input - `Response` object
   * @param options Options for the write
   *
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destination: BunFile,
    input: Response,
    options?: {
      /**
       * If `true`, create the parent directory if it doesn't exist. By default, this is `true`.
       *
       * If `false`, this will throw an error if the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  /**
   * Persist a {@link Response} body to disk.
   *
   * @param destinationPath The file path to write to. If the file doesn't
   * exist, it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input - `Response` object
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destinationPath: PathLike,
    input: Response,
    options?: {
      /**
       * If `true`, create the parent directory if it doesn't exist. By default, this is `true`.
       *
       * If `false`, this will throw an error if the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  /**
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file.
   *
   * On Linux, this uses `copy_file_range`.
   *
   * On macOS, when the destination doesn't already exist, this uses
   * [`clonefile()`](https://www.manpagez.com/man/2/clonefile/) and falls
   * back to [`fcopyfile()`](https://www.manpagez.com/man/2/fcopyfile/)
   *
   * @param destination The file to write to. If the file doesn't exist,
   * it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input The file to copy from.
   * @returns A promise that resolves with the number of bytes written.
   */

  function write(
    destination: BunFile,
    input: BunFile,
    options?: {
      /**
       * If `true`, create the parent directory if it doesn't exist. By default, this is `true`.
       *
       * If `false`, this will throw an error if the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  /**
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file.
   *
   * On Linux, this uses `copy_file_range`.
   *
   * On macOS, when the destination doesn't already exist, this uses
   * [`clonefile()`](https://www.manpagez.com/man/2/clonefile/) and falls
   * back to [`fcopyfile()`](https://www.manpagez.com/man/2/fcopyfile/)
   *
   * @param destinationPath The file path to write to. If the file doesn't
   * exist, it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input The file to copy from.
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destinationPath: PathLike,
    input: BunFile,
    options?: {
      /**
       * If `true`, create the parent directory if it doesn't exist. By default, this is `true`.
       *
       * If `false`, this will throw an error if the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  interface SystemError extends Error {
    errno?: number | undefined;
    code?: string | undefined;
    path?: string | undefined;
    syscall?: string | undefined;
  }

  /**
   * Concatenate an array of typed arrays into a single `ArrayBuffer`. This is a fast path.
   *
   * You can do this manually if you'd like, but this function will generally
   * be a little faster.
   *
   * If you want a `Uint8Array` instead, consider `Buffer.concat`.
   *
   * @param buffers An array of typed arrays to concatenate.
   * @returns An `ArrayBuffer` with the data from all the buffers.
   *
   * Here is similar code to do it manually, except about 30% slower:
   * ```js
   *   var chunks = [...];
   *   var size = 0;
   *   for (const chunk of chunks) {
   *     size += chunk.byteLength;
   *   }
   *   var buffer = new ArrayBuffer(size);
   *   var view = new Uint8Array(buffer);
   *   var offset = 0;
   *   for (const chunk of chunks) {
   *     view.set(chunk, offset);
   *     offset += chunk.byteLength;
   *   }
   *   return buffer;
   * ```
   *
   * This function is faster because it uses uninitialized memory when copying. Since the entire
   * length of the buffer is known, it is safe to use uninitialized memory.
   */
  function concatArrayBuffers(buffers: Array<ArrayBufferView | ArrayBufferLike>, maxLength?: number): ArrayBuffer;
  function concatArrayBuffers(
    buffers: Array<ArrayBufferView | ArrayBufferLike>,
    maxLength: number,
    asUint8Array: false,
  ): ArrayBuffer;
  function concatArrayBuffers(
    buffers: Array<ArrayBufferView | ArrayBufferLike>,
    maxLength: number,
    asUint8Array: true,
  ): Uint8Array;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single {@link ArrayBuffer}.
   *
   * Each chunk must be a TypedArray or an ArrayBuffer. If you need to support
   * chunks of different types, consider {@link readableStreamToBlob}
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks or the concatenated chunks as an `ArrayBuffer`.
   */
  function readableStreamToArrayBuffer(
    stream: ReadableStream<ArrayBufferView | ArrayBufferLike>,
  ): Promise<ArrayBuffer> | ArrayBuffer;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single {@link ArrayBuffer}.
   *
   * Each chunk must be a TypedArray or an ArrayBuffer. If you need to support
   * chunks of different types, consider {@link readableStreamToBlob}
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks or the concatenated chunks as a {@link Uint8Array}.
   */
  function readableStreamToBytes(
    stream: ReadableStream<ArrayBufferView | ArrayBufferLike>,
  ): Promise<Uint8Array> | Uint8Array;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single {@link Blob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link Blob}.
   */
  function readableStreamToBlob(stream: ReadableStream): Promise<Blob>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Reads the multi-part or URL-encoded form data into a {@link FormData} object
   *
   * @param stream The stream to consume.
   * @param multipartBoundaryExcludingDashes Optional boundary to use for multipart form data. If none is provided, assumes it is a URLEncoded form.
   * @returns A promise that resolves with the data encoded into a {@link FormData} object.
   *
   * @example
   * **Multipart form data example**
   * ```ts
   * // without dashes
   * const boundary = "WebKitFormBoundary" + Math.random().toString(16).slice(2);
   *
   * const myStream = getStreamFromSomewhere() // ...
   * const formData = await Bun.readableStreamToFormData(stream, boundary);
   * formData.get("foo"); // "bar"
   * ```
   *
   * **URL-encoded form data example**
   * ```ts
   * const stream = new Response("hello=123").body;
   * const formData = await Bun.readableStreamToFormData(stream);
   * formData.get("hello"); // "123"
   * ```
   */
  function readableStreamToFormData(
    stream: ReadableStream<string | NodeJS.TypedArray | ArrayBufferView>,
    multipartBoundaryExcludingDashes?: string | NodeJS.TypedArray | ArrayBufferView,
  ): Promise<FormData>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   */
  function readableStreamToText(stream: ReadableStream): Promise<string>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string and parse as JSON. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   */
  function readableStreamToJSON(stream: ReadableStream): Promise<any>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * @param stream The stream to consume
   * @returns A promise that resolves with the chunks as an array
   */
  function readableStreamToArray<T>(stream: ReadableStream<T>): Promise<T[]> | T[];

  /**
   * Escape the following characters in a string:
   *
   * @category Security
   *
   * - `"` becomes `"&quot;"`
   * - `&` becomes `"&amp;"`
   * - `'` becomes `"&#x27;"`
   * - `<` becomes `"&lt;"`
   * - `>` becomes `"&gt;"`
   *
   * This function is optimized for large input. On an M1X, it processes 480 MB/s -
   * 20 GB/s, depending on how much data is being escaped and whether there is non-ascii
   * text.
   *
   * Non-string types will be converted to a string before escaping.
   */
  function escapeHTML(input: string | object | number | boolean): string;

  /**
   * Convert a filesystem path to a file:// URL.
   *
   * @param path The path to convert.
   * @returns A {@link URL} with the file:// scheme.
   *
   * @category File System
   *
   * @example
   * ```js
   * const url = Bun.pathToFileURL("/foo/bar.txt");
   * console.log(url.href); // "file:///foo/bar.txt"
   * ```
   *
   * Internally, this function uses WebKit's URL API to
   * convert the path to a file:// URL.
   */
  function pathToFileURL(path: string): URL;

  /**
   * Extract the value from the Promise in the same tick of the event loop
   */
  function peek<T = undefined>(promise: T | Promise<T>): Promise<T> | T;
  namespace peek {
    function status<T = undefined>(promise: T | Promise<T>): "pending" | "fulfilled" | "rejected";
  }

  /**
   * Convert a {@link URL} to a filesystem path.
   *
   * @param url The URL to convert.
   * @returns A filesystem path.
   * @throws If the URL is not a URL.
   *
   * @category File System
   *
   * @example
   * ```js
   * const path = Bun.fileURLToPath(new URL("file:///foo/bar.txt"));
   * console.log(path); // "/foo/bar.txt"
   * ```
   */
  function fileURLToPath(url: URL | string): string;

  /**
   * Fast incremental writer that becomes an {@link ArrayBuffer} on end().
   */
  class ArrayBufferSink {
    start(options?: {
      asUint8Array?: boolean;
      /**
       * Preallocate an internal buffer of this size
       * This can significantly improve performance when the chunk size is small
       */
      highWaterMark?: number;
      /**
       * On {@link ArrayBufferSink.flush}, return the written data as a `Uint8Array`.
       * Writes will restart from the beginning of the buffer.
       */
      stream?: boolean;
    }): void;

    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
    /**
     * Flush the internal buffer
     *
     * If {@link ArrayBufferSink.start} was passed a `stream` option, this will return a `ArrayBuffer`
     * If {@link ArrayBufferSink.start} was passed a `stream` option and `asUint8Array`, this will return a `Uint8Array`
     * Otherwise, this will return the number of bytes written since the last flush
     *
     * This API might change later to separate Uint8ArraySink and ArrayBufferSink
     */
    flush(): number | Uint8Array | ArrayBuffer;
    end(): ArrayBuffer | Uint8Array;
  }

  /** DNS Related APIs */
  namespace dns {
    /**
     * Lookup the IP address for a hostname
     *
     * Uses non-blocking APIs by default
     *
     * @param hostname The hostname to lookup
     * @param options Options for the lookup
     *
     * @example
     * ## Basic usage
     * ```js
     * const [{ address }] = await Bun.dns.lookup('example.com');
     * ```
     *
     * ## Filter results to IPv4
     * ```js
     * import { dns } from 'bun';
     * const [{ address }] = await dns.lookup('example.com', {family: 4});
     * console.log(address); // "123.122.22.126"
     * ```
     *
     * ## Filter results to IPv6
     * ```js
     * import { dns } from 'bun';
     * const [{ address }] = await dns.lookup('example.com', {family: 6});
     * console.log(address); // "2001:db8::1"
     * ```
     *
     * ## DNS resolver client
     *
     * Bun supports three DNS resolvers:
     * - `c-ares` - Uses the c-ares library to perform DNS resolution. This is the default on Linux.
     * - `system` - Uses the system's non-blocking DNS resolver API if available, falls back to `getaddrinfo`. This is the default on macOS and the same as `getaddrinfo` on Linux.
     * - `getaddrinfo` - Uses the posix standard `getaddrinfo` function. Will cause performance issues under concurrent loads.
     *
     * To customize the DNS resolver, pass a `backend` option to `dns.lookup`:
     * ```js
     * import { dns } from 'bun';
     * const [{ address }] = await dns.lookup('example.com', {backend: 'getaddrinfo'});
     * console.log(address); // "19.42.52.62"
     * ```
     */
    function lookup(
      hostname: string,
      options?: {
        /**
         * Limit results to either IPv4, IPv6, or both
         */
        family?: 4 | 6 | 0 | "IPv4" | "IPv6" | "any";
        /**
         * Limit results to either UDP or TCP
         */
        socketType?: "udp" | "tcp";
        flags?: number;
        port?: number;

        /**
         * The DNS resolver implementation to use
         *
         * Defaults to `"c-ares"` on Linux and `"system"` on macOS. This default
         * may change in a future version of Bun if c-ares is not reliable
         * enough.
         *
         * On macOS, `system` uses the builtin macOS [non-blocking DNS
         * resolution
         * API](https://opensource.apple.com/source/Libinfo/Libinfo-222.1/lookup.subproj/netdb_async.h.auto.html).
         *
         * On Linux, `system` is the same as `getaddrinfo`.
         *
         * `c-ares` is more performant on Linux in some high concurrency
         * situations, but it lacks support support for mDNS (`*.local`,
         * `*.localhost` domains) along with some other advanced features. If
         * you run into issues using `c-ares`, you should try `system`. If the
         * hostname ends with `.local` or `.localhost`, Bun will automatically
         * use `system` instead of `c-ares`.
         *
         * [`getaddrinfo`](https://man7.org/linux/man-pages/man3/getaddrinfo.3.html)
         * is the POSIX standard function for blocking DNS resolution. Bun runs
         * it in Bun's thread pool, which is limited to `cpus / 2`. That means
         * if you run a lot of concurrent DNS lookups, concurrent IO will
         * potentially pause until the DNS lookups are done.
         *
         * On macOS, it shouldn't be necessary to use "`getaddrinfo`" because
         * `"system"` uses the same API underneath (except non-blocking).
         *
         * On Windows, libuv's non-blocking DNS resolver is used by default, and
         * when specifying backends "system", "libc", or "getaddrinfo". The c-ares
         * backend isn't currently supported on Windows.
         */
        backend?: "libc" | "c-ares" | "system" | "getaddrinfo";
      },
    ): Promise<DNSLookup[]>;

    /**
     *
     * **Experimental API**
     *
     * Prefetch a hostname.
     *
     * This will be used by fetch() and Bun.connect() to avoid DNS lookups.
     *
     * @param hostname The hostname to prefetch
     * @param port The port to prefetch. Default is 443. Port helps distinguish between IPv6 vs IPv4-only connections.
     *
     * @example
     * ```js
     * import { dns } from 'bun';
     * dns.prefetch('example.com');
     * // ... something expensive
     * await fetch('https://example.com');
     * ```
     */
    function prefetch(hostname: string, port?: number): void;

    /**
     * **Experimental API**
     */
    function getCacheStats(): {
      /**
       * The number of times a cached DNS entry that was already resolved was used.
       */
      cacheHitsCompleted: number;
      cacheHitsInflight: number;
      cacheMisses: number;
      size: number;
      errors: number;
      totalCount: number;
    };

    const ADDRCONFIG: number;
    const ALL: number;
    const V4MAPPED: number;
  }

  interface DNSLookup {
    /**
     * The IP address of the host as a string in IPv4 or IPv6 format.
     *
     * @example "127.0.0.1"
     * @example "192.168.0.1"
     * @example "2001:4860:4860::8888"
     */
    address: string;
    family: 4 | 6;

    /**
     * Time to live in seconds
     *
     * Only supported when using the `c-ares` DNS resolver via "backend" option
     * to {@link dns.lookup}. Otherwise, it's 0.
     */
    ttl: number;
  }

  interface FileBlob extends BunFile {}
  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   * - `type` is auto-set based on the file extension when possible
   *
   * @category File System
   *
   * @example
   * ```js
   * const file = Bun.file("./hello.json");
   * console.log(file.type); // "application/json"
   * console.log(await file.text()); // '{"hello":"world"}'
   * ```
   *
   * @example
   * ```js
   * await Bun.write(
   *   Bun.file("./hello.txt"),
   *   "Hello, world!"
   * );
   * ```
   */
  interface BunFile extends Blob {
    /**
     * Offset any operation on the file starting at `begin` and ending at `end`. `end` is relative to 0
     *
     * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray). Does not copy the file, open the file, or modify the file.
     *
     * If `begin` > 0, {@link Bun.write()} will be slower on macOS
     *
     * @param begin - start offset in bytes
     * @param end - absolute offset in bytes (relative to 0)
     * @param contentType - MIME type for the new BunFile
     */
    slice(begin?: number, end?: number, contentType?: string): BunFile;

    /**
     * Offset any operation on the file starting at `begin`
     *
     * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray). Does not copy the file, open the file, or modify the file.
     *
     * If `begin` > 0, {@link Bun.write}() will be slower on macOS
     *
     * @param begin - start offset in bytes
     * @param contentType - MIME type for the new BunFile
     */
    slice(begin?: number, contentType?: string): BunFile;

    /**
     * Slice the file from the beginning to the end, optionally with a new MIME type.
     *
     * @param contentType - MIME type for the new BunFile
     */
    slice(contentType?: string): BunFile;

    /**
     * Incremental writer for files and pipes.
     */
    writer(options?: { highWaterMark?: number }): FileSink;

    readonly readable: BunReadableStream;

    // TODO: writable: WritableStream;

    /**
     * A UNIX timestamp indicating when the file was last modified.
     */
    lastModified: number;
    /**
     * The name or path of the file, as specified in the constructor.
     */
    readonly name?: string;

    /**
     * Does the file exist?
     *
     * This returns true for regular files and FIFOs. It returns false for
     * directories. Note that a race condition can occur where the file is
     * deleted or renamed after this is called but before you open it.
     *
     * This does a system call to check if the file exists, which can be
     * slow.
     *
     * If using this in an HTTP server, it's faster to instead use `return new
     * Response(Bun.file(path))` and then an `error` handler to handle
     * exceptions.
     *
     * Instead of checking for a file's existence and then performing the
     * operation, it is faster to just perform the operation and handle the
     * error.
     *
     * For empty Blob, this always returns true.
     */
    exists(): Promise<boolean>;

    /**
     * Write data to the file. This is equivalent to using {@link Bun.write} with a {@link BunFile}.
     * @param data - The data to write.
     * @param options - The options to use for the write.
     */
    write(
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer | Request | Response | BunFile,
      options?: { highWaterMark?: number },
    ): Promise<number>;

    /**
     * Deletes the file.
     */
    unlink(): Promise<void>;

    /**
     * Deletes the file (same as unlink)
     */
    delete(): Promise<void>;

    /**
     *  Provides useful information about the file.
     */
    stat(): Promise<import("node:fs").Stats>;
  }

  /**
   * Configuration options for SQL client connection and behavior
   *  @example
   * const config: SQLOptions = {
   *   host: 'localhost',
   *   port: 5432,
   *   user: 'dbuser',
   *   password: 'secretpass',
   *   database: 'myapp',
   *   idleTimeout: 30,
   *   max: 20,
   *   onconnect: (client) => {
   *     console.log('Connected to database');
   *   }
   * };
   */

  interface SQLOptions {
    /** Connection URL (can be string or URL object) */
    url?: URL | string;
    /** Database server hostname */
    host?: string;
    /** Database server hostname (alias for host) */
    hostname?: string;
    /** Database server port number */
    port?: number | string;
    /** Database user for authentication */
    username?: string;
    /** Database user for authentication (alias for username) */
    user?: string;
    /** Database password for authentication */
    password?: string | (() => Promise<string>);
    /** Database password for authentication (alias for password) */
    pass?: string | (() => Promise<string>);
    /** Name of the database to connect to */
    database?: string;
    /** Name of the database to connect to (alias for database) */
    db?: string;
    /** Database adapter/driver to use */
    adapter?: string;
    /** Maximum time in seconds to wait for connection to become available */
    idleTimeout?: number;
    /** Maximum time in seconds to wait for connection to become available (alias for idleTimeout) */
    idle_timeout?: number;
    /** Maximum time in seconds to wait when establishing a connection */
    connectionTimeout?: number;
    /** Maximum time in seconds to wait when establishing a connection (alias for connectionTimeout) */
    connection_timeout?: number;
    /** Maximum lifetime in seconds of a connection */
    maxLifetime?: number;
    /** Maximum lifetime in seconds of a connection (alias for maxLifetime) */
    max_lifetime?: number;
    /** Whether to use TLS/SSL for the connection */
    tls?: TLSOptions | boolean;
    /** Whether to use TLS/SSL for the connection (alias for tls) */
    ssl?: TLSOptions | boolean;
    /** Callback function executed when a connection is established */
    onconnect?: (client: SQL) => void;
    /** Callback function executed when a connection is closed */
    onclose?: (client: SQL) => void;
    /** Maximum number of connections in the pool */
    max?: number;
    /** By default values outside i32 range are returned as strings. If this is true, values outside i32 range are returned as BigInts. */
    bigint?: boolean;
    /** Automatic creation of prepared statements, defaults to true */
    prepare?: boolean;
  }

  /**
   * Represents a SQL query that can be executed, with additional control methods
   * Extends Promise to allow for async/await usage
   */
  interface SQLQuery<T = any> extends Promise<T> {
    /** Indicates if the query is currently executing */
    active: boolean;

    /** Indicates if the query has been cancelled */
    cancelled: boolean;

    /** Cancels the executing query */
    cancel(): SQLQuery<T>;

    /** Execute as a simple query, no parameters are allowed but can execute multiple commands separated by semicolons */
    simple(): SQLQuery<T>;

    /** Executes the query */
    execute(): SQLQuery<T>;

    /** Returns the raw query result */
    raw(): SQLQuery<T>;

    /** Returns only the values from the query result */
    values(): SQLQuery<T>;
  }

  /**
   * Callback function type for transaction contexts
   * @param sql Function to execute SQL queries within the transaction
   */
  type SQLTransactionContextCallback = (sql: TransactionSQL) => Promise<any> | Array<SQLQuery>;
  /**
   * Callback function type for savepoint contexts
   * @param sql Function to execute SQL queries within the savepoint
   */
  type SQLSavepointContextCallback = (sql: SavepointSQL) => Promise<any> | Array<SQLQuery>;

  /**
   * Main SQL client interface providing connection and transaction management
   */
  interface SQL {
    /**
     * Executes a SQL query using template literals
     * @example
     * ```ts
     * const [user] = await sql`select * from users where id = ${1}`;
     * ```
     */
    (strings: string[] | TemplateStringsArray, ...values: any[]): SQLQuery;

    /**
     * Helper function for inserting an object into a query
     *
     * @example
     * ```ts
     * // Insert an object
     * const result = await sql`insert into users ${sql(users)} RETURNING *`;
     *
     * // Or pick specific columns
     * const result = await sql`insert into users ${sql(users, "id", "name")} RETURNING *`;
     *
     * // Or a single object
     * const result = await sql`insert into users ${sql(user)} RETURNING *`;
     * ```
     */
    <T extends { [Key in PropertyKey]: unknown }>(obj: T | T[] | readonly T[], ...columns: (keyof T)[]): SQLQuery;

    /**
     * Helper function for inserting any serializable value into a query
     *
     * @example
     * ```ts
     * const result = await sql`SELECT * FROM users WHERE id IN ${sql([1, 2, 3])}`;
     * ```
     */
    (obj: unknown): SQLQuery;

    /**
     * Commits a distributed transaction also know as prepared transaction in postgres or XA transaction in MySQL
     *
     * @param name - The name of the distributed transaction
     *
     * @example
     * ```ts
     * await sql.commitDistributed("my_distributed_transaction");
     * ```
     */
    commitDistributed(name: string): Promise<void>;

    /**
     * Rolls back a distributed transaction also know as prepared transaction in postgres or XA transaction in MySQL
     *
     * @param name - The name of the distributed transaction
     *
     * @example
     * ```ts
     * await sql.rollbackDistributed("my_distributed_transaction");
     * ```
     */
    rollbackDistributed(name: string): Promise<void>;

    /** Waits for the database connection to be established
     *
     * @example
     * ```ts
     * await sql.connect();
     * ```
     */
    connect(): Promise<SQL>;

    /**
     * Closes the database connection with optional timeout in seconds. If timeout is 0, it will close immediately, if is not provided it will wait for all queries to finish before closing.
     *
     * @param options - The options for the close
     *
     * @example
     * ```ts
     * await sql.close({ timeout: 1 });
     * ```
     */
    close(options?: { timeout?: number }): Promise<void>;

    /**
     * Closes the database connection with optional timeout in seconds. If timeout is 0, it will close immediately, if is not provided it will wait for all queries to finish before closing.
     * This is an alias of {@link SQL.close}
     *
     * @param options - The options for the close
     *
     * @example
     * ```ts
     * await sql.end({ timeout: 1 });
     * ```
     */
    end(options?: { timeout?: number }): Promise<void>;

    /**
     * Flushes any pending operations
     *
     * @example
     * ```ts
     * sql.flush();
     * ```
     */
    flush(): void;

    /**
     * The reserve method pulls out a connection from the pool, and returns a client that wraps the single connection.
     * This can be used for running queries on an isolated connection.
     * Calling reserve in a reserved Sql will return a new reserved connection,  not the same connection (behavior matches postgres package).
     *
     * @example
     * ```ts
     * const reserved = await sql.reserve();
     * await reserved`select * from users`;
     * await reserved.release();
     * // with in a production scenario would be something more like
     * const reserved = await sql.reserve();
     * try {
     *   // ... queries
     * } finally {
     *   await reserved.release();
     * }
     *
     * // Bun supports Symbol.dispose and Symbol.asyncDispose
     * {
     *  // always release after context (safer)
     *  using reserved = await sql.reserve()
     *  await reserved`select * from users`
     * }
     * ```
     */
    reserve(): Promise<ReservedSQL>;
    /** Begins a new transaction
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.begin will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @example
     * const [user, account] = await sql.begin(async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    begin(fn: SQLTransactionContextCallback): Promise<any>;
    /** Begins a new transaction with options
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.begin will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @example
     * const [user, account] = await sql.begin("read write", async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    begin(options: string, fn: SQLTransactionContextCallback): Promise<any>;
    /** Alternative method to begin a transaction
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.transaction will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @alias begin
     * @example
     * const [user, account] = await sql.transaction(async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    transaction(fn: SQLTransactionContextCallback): Promise<any>;
    /** Alternative method to begin a transaction with options
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.transaction will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @alias begin
     * @example
     * const [user, account] = await sql.transaction("read write", async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    transaction(options: string, fn: SQLTransactionContextCallback): Promise<any>;
    /** Begins a distributed transaction
     * Also know as Two-Phase Commit, in a distributed transaction, Phase 1 involves the coordinator preparing nodes by ensuring data is written and ready to commit, while Phase 2 finalizes with nodes committing or rolling back based on the coordinator's decision, ensuring durability and releasing locks.
     * In PostgreSQL and MySQL distributed transactions persist beyond the original session, allowing privileged users or coordinators to commit/rollback them, ensuring support for distributed transactions, recovery, and administrative tasks.
     * beginDistributed will automatic rollback if any exception are not caught, and you can commit and rollback later if everything goes well.
     * PostgreSQL natively supports distributed transactions using PREPARE TRANSACTION, while MySQL uses XA Transactions, and MSSQL also supports distributed/XA transactions. However, in MSSQL, distributed transactions are tied to the original session, the DTC coordinator, and the specific connection.
     * These transactions are automatically committed or rolled back following the same rules as regular transactions, with no option for manual intervention from other sessions, in MSSQL distributed transactions are used to coordinate transactions using Linked Servers.
     * @example
     * await sql.beginDistributed("numbers", async sql => {
     *   await sql`create table if not exists numbers (a int)`;
     *   await sql`insert into numbers values(1)`;
     * });
     * // later you can call
     * await sql.commitDistributed("numbers");
     * // or await sql.rollbackDistributed("numbers");
     */
    beginDistributed(name: string, fn: SQLTransactionContextCallback): Promise<any>;
    /** Alternative method to begin a distributed transaction
     * @alias beginDistributed
     */
    distributed(name: string, fn: SQLTransactionContextCallback): Promise<any>;
    /**If you know what you're doing, you can use unsafe to pass any string you'd like.
     * Please note that this can lead to SQL injection if you're not careful.
     * You can also nest sql.unsafe within a safe sql expression. This is useful if only part of your fraction has unsafe elements.
     * @example
     * const result = await sql.unsafe(`select ${danger} from users where id = ${dragons}`)
     */
    unsafe(string: string, values?: any[]): SQLQuery;
    /**
     * Reads a file and uses the contents as a query.
     * Optional parameters can be used if the file includes $1, $2, etc
     * @example
     * const result = await sql.file("query.sql", [1, 2, 3]);
     */
    file(filename: string, values?: any[]): SQLQuery;

    /** Current client options */
    options: SQLOptions;

    [Symbol.asyncDispose](): Promise<any>;
  }
  const SQL: {
    /**
     * Creates a new SQL client instance
     *
     * @param connectionString - The connection string for the SQL client
     *
     * @example
     * ```ts
     * const sql = new SQL("postgres://localhost:5432/mydb");
     * const sql = new SQL(new URL("postgres://localhost:5432/mydb"));
     * ```
     */
    new (connectionString: string | URL): SQL;

    /**
     * Creates a new SQL client instance with options
     *
     * @param connectionString - The connection string for the SQL client
     * @param options - The options for the SQL client
     *
     * @example
     * ```ts
     * const sql = new SQL("postgres://localhost:5432/mydb", { idleTimeout: 1000 });
     * ```
     */
    new (connectionString: string | URL, options: Omit<SQLOptions, "url">): SQL;

    /**
     * Creates a new SQL client instance with options
     *
     * @param options - The options for the SQL client
     *
     * @example
     * ```ts
     * const sql = new SQL({ url: "postgres://localhost:5432/mydb", idleTimeout: 1000 });
     * ```
     */
    new (options?: SQLOptions): SQL;
  };

  /**
   * Represents a reserved connection from the connection pool
   * Extends SQL with additional release functionality
   */
  interface ReservedSQL extends SQL {
    /** Releases the client back to the connection pool */
    release(): void;
    [Symbol.dispose](): void;
  }

  /**
   * Represents a client within a transaction context
   * Extends SQL with savepoint functionality
   */
  interface TransactionSQL extends SQL {
    /** Creates a savepoint within the current transaction */
    savepoint(name: string, fn: SQLSavepointContextCallback): Promise<any>;
    savepoint(fn: SQLSavepointContextCallback): Promise<any>;
  }
  /**
   * Represents a savepoint within a transaction
   */
  interface SavepointSQL extends SQL {}

  type CSRFAlgorithm = "blake2b256" | "blake2b512" | "sha256" | "sha384" | "sha512" | "sha512-256";
  interface CSRFGenerateOptions {
    /**
     * The number of milliseconds until the token expires. 0 means the token never expires.
     * @default 24 * 60 * 60 * 1000 (24 hours)
     */
    expiresIn?: number;
    /**
     * The encoding of the token.
     * @default "base64url"
     */
    encoding?: "base64" | "base64url" | "hex";
    /**
     * The algorithm to use for the token.
     * @default "sha256"
     */
    algorithm?: CSRFAlgorithm;
  }

  interface CSRFVerifyOptions {
    /**
     * The secret to use for the token. If not provided, a random default secret will be generated in memory and used.
     */
    secret?: string;
    /**
     * The encoding of the token.
     * @default "base64url"
     */
    encoding?: "base64" | "base64url" | "hex";
    /**
     * The algorithm to use for the token.
     * @default "sha256"
     */
    algorithm?: CSRFAlgorithm;
    /**
     * The number of milliseconds until the token expires. 0 means the token never expires.
     * @default 24 * 60 * 60 * 1000 (24 hours)
     */
    maxAge?: number;
  }

  /**
   * SQL client
   *
   * @category Database
   */
  const sql: SQL;

  /**
   * SQL client for PostgreSQL
   *
   * @category Database
   */
  const postgres: SQL;

  /**
   * Generate and verify CSRF tokens
   *
   * @category Security
   */
  namespace CSRF {
    /**
     * Generate a CSRF token.
     * @param secret The secret to use for the token. If not provided, a random default secret will be generated in memory and used.
     * @param options The options for the token.
     * @returns The generated token.
     */
    function generate(secret?: string, options?: CSRFGenerateOptions): string;

    /**
     * Verify a CSRF token.
     * @param token The token to verify.
     * @param options The options for the token.
     * @returns True if the token is valid, false otherwise.
     */
    function verify(token: string, options?: CSRFVerifyOptions): boolean;
  }

  /**
   *   This lets you use macros as regular imports
   *   @example
   *   ```
   *   {
   *     "react-relay": {
   *       "graphql": "bun-macro-relay/bun-macro-relay.tsx"
   *     }
   *   }
   *  ```
   */
  type MacroMap = Record<string, Record<string, string>>;

  /**
   * Hash a string or array buffer using Wyhash
   *
   * This is not a cryptographic hash function.
   * @param data The data to hash.
   * @param seed The seed to use.
   */
  const hash: ((
    data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    seed?: number | bigint,
  ) => number | bigint) &
    Hash;

  interface Hash {
    wyhash: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;
    adler32: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer) => number;
    crc32: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer) => number;
    cityHash32: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer) => number;
    cityHash64: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;
    xxHash32: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: number) => number;
    xxHash64: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;
    xxHash3: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;
    murmur32v3: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: number) => number;
    murmur32v2: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: number) => number;
    murmur64v2: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;
    rapidhash: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;
  }

  type JavaScriptLoader = "jsx" | "js" | "ts" | "tsx";

  /**
   * Fast deep-equality check two objects.
   *
   * This also powers expect().toEqual in `bun:test`
   */
  function deepEquals(
    a: any,
    b: any,
    /** @default false */
    strict?: boolean,
  ): boolean;

  /**
   * Returns true if all properties in the subset exist in the
   * other and have equal values.
   *
   * This also powers expect().toMatchObject in `bun:test`
   */
  function deepMatch(subset: unknown, a: unknown): boolean;

  /**
   * tsconfig.json options supported by Bun
   */
  interface TSConfig {
    extends?: string;
    compilerOptions?: {
      paths?: Record<string, string[]>;
      baseUrl?: string;
      /** "preserve" is not supported yet */
      jsx?: "preserve" | "react" | "react-jsx" | "react-jsxdev";
      jsxFactory?: string;
      jsxFragmentFactory?: string;
      jsxImportSource?: string;
      useDefineForClassFields?: boolean;
      importsNotUsedAsValues?: "remove" | "preserve" | "error";
      /** moduleSuffixes is not supported yet */
      moduleSuffixes?: any;
    };
  }

  interface TranspilerOptions {
    /**
     * Replace key with value. Value must be a JSON string.
     * @example
     *  ```
     *  { "process.env.NODE_ENV": "\"production\"" }
     * ```
     */
    define?: Record<string, string>;

    /** What is the default loader used for this transpiler?  */
    loader?: JavaScriptLoader;

    /**  What platform are we targeting? This may affect how import and/or require is used */
    /**  @example "browser" */
    target?: Target;

    /**
     *  TSConfig.json file as stringified JSON or an object
     *  Use this to set a custom JSX factory, fragment, or import source
     *  For example, if you want to use Preact instead of React. Or if you want to use Emotion.
     */
    tsconfig?: string | TSConfig;

    /**
     *    Replace an import statement with a macro.
     *
     *    This will remove the import statement from the final output
     *    and replace any function calls or template strings with the result returned by the macro
     *
     *    @example
     *    ```json
     *    {
     *        "react-relay": {
     *            "graphql": "bun-macro-relay"
     *        }
     *    }
     *    ```
     *
     *    Code that calls `graphql` will be replaced with the result of the macro.
     *
     *    ```js
     *    import {graphql} from "react-relay";
     *
     *    // Input:
     *    const query = graphql`
     *        query {
     *            ... on User {
     *                id
     *            }
     *        }
     *    }`;
     *    ```
     *
     *    Will be replaced with:
     *
     *    ```js
     *    import UserQuery from "./UserQuery.graphql";
     *    const query = UserQuery;
     *    ```
     */
    macro?: MacroMap;

    autoImportJSX?: boolean;
    allowBunRuntime?: boolean;
    exports?: {
      eliminate?: string[];
      replace?: Record<string, string>;
    };
    treeShaking?: boolean;
    trimUnusedImports?: boolean;
    jsxOptimizationInline?: boolean;

    /**
     * **Experimental**
     *
     * Minify whitespace and comments from the output.
     */
    minifyWhitespace?: boolean;
    /**
     * **Experimental**
     *
     * Enabled by default, use this to disable dead code elimination.
     *
     * Some other transpiler options may still do some specific dead code elimination.
     */
    deadCodeElimination?: boolean;

    /**
     * This does two things (and possibly more in the future):
     * 1. `const` declarations to primitive types (excluding Object/Array) at the top of a scope before any `let` or `var` declarations will be inlined into their usages.
     * 2. `let` and `const` declarations only used once are inlined into their usages.
     *
     * JavaScript engines typically do these optimizations internally, however
     * it might only happen much later in the compilation pipeline, after code
     * has been executed many many times.
     *
     * This will typically shrink the output size of code, but it might increase
     * it in some cases. Do your own benchmarks!
     */
    inline?: boolean;

    /**
     * @default "warn"
     */
    logLevel?: "verbose" | "debug" | "info" | "warn" | "error";
  }

  /**
   * Quickly transpile TypeScript, JSX, or JS to modern JavaScript.
   *
   * @example
   * ```js
   * const transpiler = new Bun.Transpiler();
   * transpiler.transformSync(`
   *   const App = () => <div>Hello World</div>;
   * export default App;
   * `);
   * // This outputs:
   * const output = `
   * const App = () => jsx("div", {
   *   children: "Hello World"
   * }, undefined, false, undefined, this);
   * export default App;
   * `
   * ```
   */

  class Transpiler {
    constructor(options?: TranspilerOptions);

    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     */
    transform(code: Bun.StringOrBuffer, loader?: JavaScriptLoader): Promise<string>;
    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     */
    transformSync(code: Bun.StringOrBuffer, loader: JavaScriptLoader, ctx: object): string;
    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     * @param ctx An object to pass to macros
     */
    transformSync(code: Bun.StringOrBuffer, ctx: object): string;

    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     */
    transformSync(code: Bun.StringOrBuffer, loader?: JavaScriptLoader): string;

    /**
     * Get a list of import paths and paths from a TypeScript, JSX, TSX, or JavaScript file.
     * @param code The code to scan
     * @example
     * ```js
     * const {imports, exports} = transpiler.scan(`
     * import {foo} from "baz";
     * export const hello = "hi!";
     * `);
     *
     * console.log(imports); // ["baz"]
     * console.log(exports); // ["hello"]
     * ```
     */
    scan(code: Bun.StringOrBuffer): { exports: string[]; imports: Import[] };

    /**
     *  Get a list of import paths from a TypeScript, JSX, TSX, or JavaScript file.
     * @param code The code to scan
     * @example
     * ```js
     * const imports = transpiler.scanImports(`
     * import {foo} from "baz";
     * import type {FooType} from "bar";
     * import type {DogeType} from "wolf";
     * `);
     *
     * console.log(imports); // ["baz"]
     * ```
     * This is a fast path which performs less work than `scan`.
     */
    scanImports(code: Bun.StringOrBuffer): Import[];
  }

  type ImportKind =
    | "import-statement"
    | "require-call"
    | "require-resolve"
    | "dynamic-import"
    | "import-rule"
    | "url-token"
    | "internal"
    | "entry-point-run"
    | "entry-point-build";

  interface Import {
    path: string;
    kind: ImportKind;
  }

  /**
   * @see [Bun.build API docs](https://bun.sh/docs/bundler#api)
   */
  interface BuildConfig {
    entrypoints: string[]; // list of file path
    outdir?: string; // output directory
    /**
     * @default "browser"
     */
    target?: Target; // default: "browser"
    /**
     * Output module format. Top-level await is only supported for `"esm"`.
     *
     * Can be:
     * - `"esm"`
     * - `"cjs"` (**experimental**)
     * - `"iife"` (**experimental**)
     *
     * @default "esm"
     */
    format?: /**

     * ECMAScript Module format
     */
    | "esm"
      /**
       * CommonJS format
       * **Experimental**
       */
      | "cjs"
      /**
       * IIFE format
       * **Experimental**
       */
      | "iife";
    naming?:
      | string
      | {
          chunk?: string;
          entry?: string;
          asset?: string;
        }; // | string;
    root?: string; // project root
    splitting?: boolean; // default true, enable code splitting
    plugins?: BunPlugin[];
    // manifest?: boolean; // whether to return manifest
    external?: string[];
    packages?: "bundle" | "external";
    publicPath?: string;
    define?: Record<string, string>;
    // origin?: string; // e.g. http://mydomain.com
    loader?: { [k in string]: Loader };
    /**
     * Specifies if and how to generate source maps.
     *
     * - `"none"` - No source maps are generated
     * - `"linked"` - A separate `*.ext.map` file is generated alongside each
     *   `*.ext` file. A `//# sourceMappingURL` comment is added to the output
     *   file to link the two. Requires `outdir` to be set.
     * - `"inline"` - an inline source map is appended to the output file.
     * - `"external"` - Generate a separate source map file for each input file.
     *   No `//# sourceMappingURL` comment is added to the output file.
     *
     * `true` and `false` are aliases for `"inline"` and `"none"`, respectively.
     *
     * @default "none"
     *
     * @see {@link outdir} required for `"linked"` maps
     * @see {@link publicPath} to customize the base url of linked source maps
     */
    sourcemap?: "none" | "linked" | "inline" | "external" | "linked" | boolean;

    /**
     * package.json `exports` conditions used when resolving imports
     *
     * Equivalent to `--conditions` in `bun build` or `bun run`.
     *
     * https://nodejs.org/api/packages.html#exports
     */
    conditions?: Array<string> | string;

    /**
     * Controls how environment variables are handled during bundling.
     *
     * Can be one of:
     * - `"inline"`: Injects environment variables into the bundled output by converting `process.env.FOO`
     *   references to string literals containing the actual environment variable values
     * - `"disable"`: Disables environment variable injection entirely
     * - A string ending in `*`: Inlines environment variables that match the given prefix.
     *   For example, `"MY_PUBLIC_*"` will only include env vars starting with "MY_PUBLIC_"
     *
     * @example
     * ```ts
     * Bun.build({
     *   env: "MY_PUBLIC_*",
     *   entrypoints: ["src/index.ts"],
     * })
     * ```
     */
    env?: "inline" | "disable" | `${string}*`;

    /**
     * Whether to enable minification.
     *
     * Use `true`/`false` to enable/disable all minification options. Alternatively,
     * you can pass an object for granular control over certain minifications.
     *
     * @default false
     */
    minify?:
      | boolean
      | {
          whitespace?: boolean;
          syntax?: boolean;
          identifiers?: boolean;
        };

    /**
     * Ignore dead code elimination/tree-shaking annotations such as @__PURE__ and package.json
     * "sideEffects" fields. This should only be used as a temporary workaround for incorrect
     * annotations in libraries.
     */
    ignoreDCEAnnotations?: boolean;

    /**
     * Force emitting @__PURE__ annotations even if minify.whitespace is true.
     */
    emitDCEAnnotations?: boolean;

    // treeshaking?: boolean;

    // jsx?:
    //   | "automatic"
    //   | "classic"
    //   | /* later: "preserve" */ {
    //       runtime?: "automatic" | "classic"; // later: "preserve"
    //       /** Only works when runtime=classic */
    //       factory?: string; // default: "React.createElement"
    //       /** Only works when runtime=classic */
    //       fragment?: string; // default: "React.Fragment"
    //       /** Only works when runtime=automatic */
    //       importSource?: string; // default: "react"
    //     };

    /**
     * Generate bytecode for the output. This can dramatically improve cold
     * start times, but will make the final output larger and slightly increase
     * memory usage.
     *
     * Bytecode is currently only supported for CommonJS (`format: "cjs"`).
     *
     * Must be `target: "bun"`
     * @default false
     */
    bytecode?: boolean;

    /**
     * Add a banner to the bundled code such as "use client";
     */
    banner?: string;

    /**
     * Add a footer to the bundled code such as a comment block like
     *
     * `// made with bun!`
     */
    footer?: string;

    /**
     * Drop function calls to matching property accesses.
     */
    drop?: string[];

    /**
     * When set to `true`, the returned promise rejects with an AggregateError when a build failure happens.
     * When set to `false`, the `success` property of the returned object will be `false` when a build failure happens.
     * This defaults to `true`.
     */
    throw?: boolean;
  }

  /**
   * Hash and verify passwords using argon2 or bcrypt
   *
   * These are fast APIs that can run in a worker thread if used asynchronously.
   *
   * @see [Bun.password API docs](https://bun.sh/guides/util/hash-a-password)
   *
   * @category Security
   */
  namespace Password {
    interface Argon2Algorithm {
      algorithm: "argon2id" | "argon2d" | "argon2i";

      /**
       * Memory cost, which defines the memory usage, given in kibibytes.
       */
      memoryCost?: number;
      /**
       * Defines the amount of computation realized and therefore the execution
       * time, given in number of iterations.
       */
      timeCost?: number;
    }

    interface BCryptAlgorithm {
      algorithm: "bcrypt";

      /**
       * A number between 4 and 31. The default is 10.
       */
      cost?: number;
    }

    type AlgorithmLabel = (BCryptAlgorithm | Argon2Algorithm)["algorithm"];
  }

  /**
   * Hash and verify passwords using argon2 or bcrypt. The default is argon2.
   * Password hashing functions are necessarily slow, and this object will
   * automatically run in a worker thread.
   *
   * @see [Bun.password API docs](https://bun.sh/guides/util/hash-a-password)
   *
   * The underlying implementation of these functions are provided by the Zig
   * Standard Library. Thanks to \@jedisct1 and other Zig contributors for their
   * work on this.
   *
   * @example
   * **Example with argon2**
   * ```ts
   * import {password} from "bun";
   *
   * const hash = await password.hash("hello world");
   * const verify = await password.verify("hello world", hash);
   * console.log(verify); // true
   * ```
   *
   * **Example with bcrypt**
   * ```ts
   * import {password} from "bun";
   *
   * const hash = await password.hash("hello world", "bcrypt");
   * // algorithm is optional, will be inferred from the hash if not specified
   * const verify = await password.verify("hello world", hash, "bcrypt");
   *
   * console.log(verify); // true
   * ```
   *
   * @category Security
   */
  const password: {
    /**
     * Verify a password against a previously hashed password.
     *
     * @returns true if the password matches, false otherwise
     *
     * @example
     * ```ts
     * import {password} from "bun";
     * await password.verify("hey", "$argon2id$v=19$m=65536,t=2,p=1$ddbcyBcbAcagei7wSkZFiouX6TqnUQHmTyS5mxGCzeM$+3OIaFatZ3n6LtMhUlfWbgJyNp7h8/oIsLK+LzZO+WI");
     * // true
     * ```
     *
     * @throws If the algorithm is specified and does not match the hash
     * @throws If the algorithm is invalid
     * @throws if the hash is invalid
     */
    verify(
      /**
       * The password to verify.
       *
       * If empty, always returns false
       */
      password: Bun.StringOrBuffer,
      /**
       * Previously hashed password.
       * If empty, always returns false
       */
      hash: Bun.StringOrBuffer,
      /**
       * If not specified, the algorithm will be inferred from the hash.
       *
       * If specified and the algorithm does not match the hash, this function
       * throws an error.
       */
      algorithm?: Password.AlgorithmLabel,
    ): Promise<boolean>;
    /**
     * Asynchronously hash a password using argon2 or bcrypt. The default is argon2.
     *
     * @returns A promise that resolves to the hashed password
     *
     * @example
     * **Example with argon2**
     * ```ts
     * import {password} from "bun";
     * const hash = await password.hash("hello world");
     * console.log(hash); // $argon2id$v=1...
     * const verify = await password.verify("hello world", hash);
     * ```
     *
     * **Example with bcrypt**
     * ```ts
     * import {password} from "bun";
     * const hash = await password.hash("hello world", "bcrypt");
     * console.log(hash); // $2b$10$...
     * const verify = await password.verify("hello world", hash);
     * ```
     */
    hash(
      /**
       * The password to hash
       *
       * If empty, this function throws an error. It is usually a programming
       * mistake to hash an empty password.
       */
      password: Bun.StringOrBuffer,
      /**
       * When using bcrypt, passwords exceeding 72 characters will be SHA512'd before
       *
       * @default "argon2id"
       */
      algorithm?: Password.AlgorithmLabel | Password.Argon2Algorithm | Password.BCryptAlgorithm,
    ): Promise<string>;

    /**
     * Synchronously hash and verify passwords using argon2 or bcrypt. The default is argon2.
     * Warning: password hashing is slow, consider using {@link Bun.password.verify}
     * instead which runs in a worker thread.
     *
     * The underlying implementation of these functions are provided by the Zig
     * Standard Library. Thanks to \@jedisct1 and other Zig contributors for their
     * work on this.
     *
     * @example
     * **Example with argon2**
     * ```ts
     * import {password} from "bun";
     *
     * const hash = await password.hashSync("hello world");
     * const verify = await password.verifySync("hello world", hash);
     * console.log(verify); // true
     * ```
     *
     * **Example with bcrypt**
     * ```ts
     * import {password} from "bun";
     *
     * const hash = await password.hashSync("hello world", "bcrypt");
     * // algorithm is optional, will be inferred from the hash if not specified
     * const verify = await password.verifySync("hello world", hash, "bcrypt");
     *
     * console.log(verify); // true
     * ```
     */
    verifySync(
      /**
       * The password to verify.
       */
      password: Bun.StringOrBuffer,
      /**
       * The hash to verify against.
       */
      hash: Bun.StringOrBuffer,
      /**
       * If not specified, the algorithm will be inferred from the hash.
       */
      algorithm?: Password.AlgorithmLabel,
    ): boolean;

    /**
     * Synchronously hash and verify passwords using argon2 or bcrypt. The default is argon2.
     * Warning: password hashing is slow, consider using {@link Bun.password.hash}
     * instead which runs in a worker thread.
     *
     * The underlying implementation of these functions are provided by the Zig
     * Standard Library. Thanks to \@jedisct1 and other Zig contributors for their
     * work on this.
     *
     * @example
     * **Example with argon2**
     * ```ts
     * import {password} from "bun";
     *
     * const hash = await password.hashSync("hello world");
     * const verify = await password.verifySync("hello world", hash);
     * console.log(verify); // true
     * ```
     *
     * **Example with bcrypt**
     * ```ts
     * import {password} from "bun";
     *
     * const hash = await password.hashSync("hello world", "bcrypt");
     * // algorithm is optional, will be inferred from the hash if not specified
     * const verify = await password.verifySync("hello world", hash, "bcrypt");
     *
     * console.log(verify); // true
     * ```
     */
    hashSync(
      /**
       * The password to hash
       *
       * If empty, this function throws an error. It is usually a programming
       * mistake to hash an empty password.
       */
      password: Bun.StringOrBuffer,

      /**
       * When using bcrypt, passwords exceeding 72 characters will be SHA256'd before
       *
       * @default "argon2id"
       */
      algorithm?: Password.AlgorithmLabel | Password.Argon2Algorithm | Password.BCryptAlgorithm,
    ): string;
  };

  /**
   * A build artifact represents a file that was generated by the bundler @see {@link Bun.build}
   *
   * @category Bundler
   */
  interface BuildArtifact extends Blob {
    path: string;
    loader: Loader;
    hash: string | null;
    kind: "entry-point" | "chunk" | "asset" | "sourcemap" | "bytecode";
    sourcemap: BuildArtifact | null;
  }

  /**
   * The output of a build
   *
   * @category Bundler
   */
  interface BuildOutput {
    outputs: BuildArtifact[];
    success: boolean;
    logs: Array<BuildMessage | ResolveMessage>;
  }

  /**
   * Bundles JavaScript, TypeScript, CSS, HTML and other supported files into optimized outputs.
   *
   * @param config - Build configuration options
   * @returns Promise that resolves to build output containing generated artifacts and build status
   * @throws {AggregateError} When build fails and config.throw is true (default in Bun 1.2+)
   *
   * @category Bundler
   *
   * @example
   * Basic usage - Bundle a single entrypoint and check results
   *```ts
   * const result = await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist'
   * });
   *
   * if (!result.success) {
   *   console.error('Build failed:', result.logs);
   *   process.exit(1);
   * }
   *```
   *
   * @example
   * Set up multiple entrypoints with code splitting enabled
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/app.tsx', './src/admin.tsx'],
   *   outdir: './dist',
   *   splitting: true,
   *   sourcemap: "external"
   * });
   *```
   *
   * @example
   * Configure minification and optimization settings
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   minify: {
   *     whitespace: true,
   *     identifiers: true,
   *     syntax: true
   *   },
   *   drop: ['console', 'debugger']
   * });
   *```
   *
   * @example
   * Set up custom loaders and mark packages as external
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   loader: {
   *     '.png': 'dataurl',
   *     '.svg': 'file',
   *     '.txt': 'text',
   *     '.json': 'json'
   *   },
   *   external: ['react', 'react-dom']
   * });
   *```
   *
   * @example
   * Configure environment variable handling with different modes
   *```ts
   * // Inline all environment variables
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   env: 'inline'
   * });
   *
   * // Only include specific env vars
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   env: 'PUBLIC_*'
   * });
   *```
   *
   * @example
   * Set up custom naming patterns for all output types
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   naming: {
   *     entry: '[dir]/[name]-[hash].[ext]',
   *     chunk: 'chunks/[name]-[hash].[ext]',
   *     asset: 'assets/[name]-[hash].[ext]'
   *   }
   * });
   *```
   *
   * @example
   * Work with build artifacts in different formats
   *```ts
   * const result = await Bun.build({
   *   entrypoints: ['./src/index.tsx']
   * });
   * for (const artifact of result.outputs) {
   *   const text = await artifact.text();
   *   const buffer = await artifact.arrayBuffer();
   *   const bytes = await artifact.bytes();
   *   new Response(artifact);
   *   await Bun.write(artifact.path, artifact);
   * }
   *```
   *
   * @example
   * Implement comprehensive error handling with position info
   *```ts
   * try {
   *   const result = await Bun.build({
   *     entrypoints: ['./src/index.tsx'],
   *   });
   * } catch (e) {
   *   const error = e as AggregateError;
   *   console.error('Build failed:');
   *   for (const msg of error.errors) {
   *     if ('position' in msg) {
   *       console.error(
   *         `${msg.message} at ${msg.position?.file}:${msg.position?.line}:${msg.position?.column}`
   *       );
   *     } else {
   *       console.error(msg.message);
   *     }
   *   }
   * }
   *```
   *
   * @example
   * Set up Node.js target with specific configurations
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/server.ts'],
   *   outdir: './dist',
   *   target: 'node',
   *   format: 'cjs',
   *   sourcemap: 'external',
   *   minify: false,
   *   packages: 'external'
   * });
   *```
   *
   * @example
   * Configure experimental CSS bundling with multiple themes
   *```ts
   * await Bun.build({
   *   entrypoints: [
   *     './src/styles.css',
   *     './src/themes/dark.css',
   *     './src/themes/light.css'
   *   ],
   *   outdir: './dist/css',
   * });
   *```
   *
   * @example
   * Define compile-time constants and version information
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   define: {
   *     'process.env.NODE_ENV': JSON.stringify('production'),
   *     'CONSTANTS.VERSION': JSON.stringify('1.0.0'),
   *     'CONSTANTS.BUILD_TIME': JSON.stringify(new Date().toISOString())
   *   }
   * });
   *```
   *
   * @example
   * Create a custom plugin for handling special file types
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   plugins: [
   *     {
   *       name: 'my-plugin',
   *       setup(build) {
   *         build.onLoad({ filter: /\.custom$/ }, async (args) => {
   *           const content = await Bun.file(args.path).text();
   *           return {
   *             contents: `export default ${JSON.stringify(content)}`,
   *             loader: 'js'
   *           };
   *         });
   *       }
   *     }
   *   ]
   * });
   *```
   *
   * @example
   * Enable bytecode generation for faster startup
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/server.ts'],
   *   outdir: './dist',
   *   target: 'bun',
   *   format: 'cjs',
   *   bytecode: true
   * });
   *```
   *
   * @example
   * Add custom banner and footer to output files
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   banner: '"use client";\n// Built with Bun',
   *   footer: '// Generated on ' + new Date().toISOString()
   * });
   *```
   *
   * @example
   * Configure CDN public path for asset loading
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   publicPath: 'https://cdn.example.com/assets/',
   *   loader: {
   *     '.png': 'file',
   *     '.svg': 'file'
   *   }
   * });
   *```
   *
   * @example
   * Set up package export conditions for different environments
   *```ts
   * await Bun.build({
   *   entrypoints: ['./src/index.tsx'],
   *   outdir: './dist',
   *   conditions: ['production', 'browser', 'module'],
   *   packages: 'external'
   * });
   *```
   */
  function build(config: BuildConfig): Promise<BuildOutput>;

  /**
   * A status that represents the outcome of a sent message.
   *
   * - if **0**, the message was **dropped**.
   * - if **-1**, there is **backpressure** of messages.
   * - if **>0**, it represents the **number of bytes sent**.
   *
   * @example
   * ```js
   * const status = ws.send("Hello!");
   * if (status === 0) {
   *   console.log("Message was dropped");
   * } else if (status === -1) {
   *   console.log("Backpressure was applied");
   * } else {
   *   console.log(`Success! Sent ${status} bytes`);
   * }
   * ```
   */
  type ServerWebSocketSendStatus = number;

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
   * A fast WebSocket designed for servers.
   *
   * Features:
   * - **Message compression** - Messages can be compressed
   * - **Backpressure** - If the client is not ready to receive data, the server will tell you.
   * - **Dropped messages** - If the client cannot receive data, the server will tell you.
   * - **Topics** - Messages can be {@link ServerWebSocket.publish}ed to a specific topic and the client can {@link ServerWebSocket.subscribe} to topics
   *
   * This is slightly different than the browser {@link WebSocket} which Bun supports for clients.
   *
   * Powered by [uWebSockets](https://github.com/uNetworking/uWebSockets).
   *
   * @example
   * ```ts
   * Bun.serve({
   *   websocket: {
   *     open(ws) {
   *       console.log("Connected", ws.remoteAddress);
   *     },
   *     message(ws, data) {
   *       console.log("Received", data);
   *       ws.send(data);
   *     },
   *     close(ws, code, reason) {
   *       console.log("Disconnected", code, reason);
   *     },
   *   }
   * });
   * ```
   *
   * @category HTTP & Networking
   */
  interface ServerWebSocket<T = undefined> {
    /**
     * Sends a message to the client.
     *
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.send("Hello!");
     * ws.send("Compress this.", true);
     * ws.send(new Uint8Array([1, 2, 3, 4]));
     */
    send(data: string | BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a text message to the client.
     *
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.send("Hello!");
     * ws.send("Compress this.", true);
     */
    sendText(data: string, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a binary message to the client.
     *
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.send(new TextEncoder().encode("Hello!"));
     * ws.send(new Uint8Array([1, 2, 3, 4]), true);
     */
    sendBinary(data: BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Closes the connection.
     *
     * Here is a list of close codes:
     * - `1000` means "normal closure" **(default)**
     * - `1009` means a message was too big and was rejected
     * - `1011` means the server encountered an error
     * - `1012` means the server is restarting
     * - `1013` means the server is too busy or the client is rate-limited
     * - `4000` through `4999` are reserved for applications (you can use it!)
     *
     * To close the connection abruptly, use `terminate()`.
     *
     * @param code The close code to send
     * @param reason The close reason to send
     */
    close(code?: number, reason?: string): void;

    /**
     * Abruptly close the connection.
     *
     * To gracefully close the connection, use `close()`.
     */
    terminate(): void;

    /**
     * Sends a ping.
     *
     * @param data The data to send
     */
    ping(data?: string | BufferSource): ServerWebSocketSendStatus;

    /**
     * Sends a pong.
     *
     * @param data The data to send
     */
    pong(data?: string | BufferSource): ServerWebSocketSendStatus;

    /**
     * Sends a message to subscribers of the topic.
     *
     * @param topic The topic name.
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.publish("chat", "Hello!");
     * ws.publish("chat", "Compress this.", true);
     * ws.publish("chat", new Uint8Array([1, 2, 3, 4]));
     */
    publish(topic: string, data: string | BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a text message to subscribers of the topic.
     *
     * @param topic The topic name.
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.publish("chat", "Hello!");
     * ws.publish("chat", "Compress this.", true);
     */
    publishText(topic: string, data: string, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a binary message to subscribers of the topic.
     *
     * @param topic The topic name.
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.publish("chat", new TextEncoder().encode("Hello!"));
     * ws.publish("chat", new Uint8Array([1, 2, 3, 4]), true);
     */
    publishBinary(topic: string, data: BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Subscribes a client to the topic.
     *
     * @param topic The topic name.
     * @example
     * ws.subscribe("chat");
     */
    subscribe(topic: string): void;

    /**
     * Unsubscribes a client to the topic.
     *
     * @param topic The topic name.
     * @example
     * ws.unsubscribe("chat");
     */
    unsubscribe(topic: string): void;

    /**
     * Is the client subscribed to a topic?
     *
     * @param topic The topic name.
     * @example
     * ws.subscribe("chat");
     * console.log(ws.isSubscribed("chat")); // true
     */
    isSubscribed(topic: string): boolean;

    /**
     * Batches `send()` and `publish()` operations, which makes it faster to send data.
     *
     * The `message`, `open`, and `drain` callbacks are automatically corked, so
     * you only need to call this if you are sending messages outside of those
     * callbacks or in async functions.
     *
     * @param callback The callback to run.
     * @example
     * ws.cork((ctx) => {
     *   ctx.send("These messages");
     *   ctx.sendText("are sent");
     *   ctx.sendBinary(new TextEncoder().encode("together!"));
     * });
     */
    cork<T = unknown>(callback: (ws: ServerWebSocket<T>) => T): T;

    /**
     * The IP address of the client.
     *
     * @example
     * console.log(socket.remoteAddress); // "127.0.0.1"
     */
    readonly remoteAddress: string;

    /**
     * The ready state of the client.
     *
     * - if `0`, the client is connecting.
     * - if `1`, the client is connected.
     * - if `2`, the client is closing.
     * - if `3`, the client is closed.
     *
     * @example
     * console.log(socket.readyState); // 1
     */
    readonly readyState: WebSocketReadyState;

    /**
     * Sets how binary data is returned in events.
     *
     * - if `nodebuffer`, binary data is returned as `Buffer` objects. **(default)**
     * - if `arraybuffer`, binary data is returned as `ArrayBuffer` objects.
     * - if `uint8array`, binary data is returned as `Uint8Array` objects.
     *
     * @example
     * let ws: WebSocket;
     * ws.binaryType = "uint8array";
     * ws.addEventListener("message", ({ data }) => {
     *   console.log(data instanceof Uint8Array); // true
     * });
     */
    binaryType?: "nodebuffer" | "arraybuffer" | "uint8array";

    /**
     * Custom data that you can assign to a client, can be read and written at any time.
     *
     * @example
     * import { serve } from "bun";
     *
     * serve({
     *   fetch(request, server) {
     *     const data = {
     *       accessToken: request.headers.get("Authorization"),
     *     };
     *     if (server.upgrade(request, { data })) {
     *       return;
     *     }
     *     return new Response();
     *   },
     *   websocket: {
     *     open(ws) {
     *       console.log(ws.data.accessToken);
     *     }
     *   }
     * });
     */
    data: T;

    getBufferedAmount(): number;
  }

  /**
   * Compression options for WebSocket messages.
   */
  type WebSocketCompressor =
    | "disable"
    | "shared"
    | "dedicated"
    | "3KB"
    | "4KB"
    | "8KB"
    | "16KB"
    | "32KB"
    | "64KB"
    | "128KB"
    | "256KB";

  /**
   * Create a server-side {@link ServerWebSocket} handler for use with {@link Bun.serve}
   *
   * @category HTTP & Networking
   *
   * @example
   * ```ts
   * import { websocket, serve } from "bun";
   *
   * serve<{name: string}>({
   *   port: 3000,
   *   websocket: {
   *     open: (ws) => {
   *       console.log("Client connected");
   *    },
   *     message: (ws, message) => {
   *       console.log(`${ws.data.name}: ${message}`);
   *    },
   *     close: (ws) => {
   *       console.log("Client disconnected");
   *    },
   *  },
   *
   *   fetch(req, server) {
   *     const url = new URL(req.url);
   *     if (url.pathname === "/chat") {
   *       const upgraded = server.upgrade(req, {
   *         data: {
   *           name: new URL(req.url).searchParams.get("name"),
   *        },
   *      });
   *       if (!upgraded) {
   *         return new Response("Upgrade failed", { status: 400 });
   *      }
   *      return;
   *    }
   *     return new Response("Hello World");
   *  },
   * });
   * ```
   */
  interface WebSocketHandler<T = undefined> {
    /**
     * Called when the server receives an incoming message.
     *
     * If the message is not a `string`, its type is based on the value of `binaryType`.
     * - if `nodebuffer`, then the message is a `Buffer`.
     * - if `arraybuffer`, then the message is an `ArrayBuffer`.
     * - if `uint8array`, then the message is a `Uint8Array`.
     *
     * @param ws The websocket that sent the message
     * @param message The message received
     */
    message(ws: ServerWebSocket<T>, message: string | Buffer): void | Promise<void>;

    /**
     * Called when a connection is opened.
     *
     * @param ws The websocket that was opened
     */
    open?(ws: ServerWebSocket<T>): void | Promise<void>;

    /**
     * Called when a connection was previously under backpressure,
     * meaning it had too many queued messages, but is now ready to receive more data.
     *
     * @param ws The websocket that is ready for more data
     */
    drain?(ws: ServerWebSocket<T>): void | Promise<void>;

    /**
     * Called when a connection is closed.
     *
     * @param ws The websocket that was closed
     * @param code The close code
     * @param reason The close reason
     */
    close?(ws: ServerWebSocket<T>, code: number, reason: string): void | Promise<void>;

    /**
     * Called when a ping is sent.
     *
     * @param ws The websocket that received the ping
     * @param data The data sent with the ping
     */
    ping?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;

    /**
     * Called when a pong is received.
     *
     * @param ws The websocket that received the ping
     * @param data The data sent with the ping
     */
    pong?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;

    /**
     * Sets the maximum size of messages in bytes.
     *
     * Default is 16 MB, or `1024 * 1024 * 16` in bytes.
     */
    maxPayloadLength?: number;

    /**
     * Sets the maximum number of bytes that can be buffered on a single connection.
     *
     * Default is 16 MB, or `1024 * 1024 * 16` in bytes.
     */
    backpressureLimit?: number;

    /**
     * Sets if the connection should be closed if `backpressureLimit` is reached.
     *
     * Default is `false`.
     */
    closeOnBackpressureLimit?: boolean;

    /**
     * Sets the the number of seconds to wait before timing out a connection
     * due to no messages or pings.
     *
     * Default is 2 minutes, or `120` in seconds.
     */
    idleTimeout?: number;

    /**
     * Should `ws.publish()` also send a message to `ws` (itself), if it is subscribed?
     *
     * Default is `false`.
     */
    publishToSelf?: boolean;

    /**
     * Should the server automatically send and respond to pings to clients?
     *
     * Default is `true`.
     */
    sendPings?: boolean;

    /**
     * Sets the compression level for messages, for clients that supports it. By default, compression is disabled.
     *
     * Default is `false`.
     */
    perMessageDeflate?:
      | boolean
      | {
          /**
           * Sets the compression level.
           */
          compress?: WebSocketCompressor | boolean;
          /**
           * Sets the decompression level.
           */
          decompress?: WebSocketCompressor | boolean;
        };
  }

  namespace RouterTypes {
    type ExtractRouteParams<T> = T extends `${string}:${infer Param}/${infer Rest}`
      ? { [K in Param]: string } & ExtractRouteParams<Rest>
      : T extends `${string}:${infer Param}`
        ? { [K in Param]: string }
        : T extends `${string}*`
          ? {}
          : {};

    type RouteHandler<T extends string> = (req: BunRequest<T>, server: Server) => Response | Promise<Response>;

    type RouteHandlerWithWebSocketUpgrade<T extends string> = (
      req: BunRequest<T>,
      server: Server,
    ) => Response | undefined | void | Promise<Response | undefined | void>;

    type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

    type RouteHandlerObject<T extends string> = {
      [K in HTTPMethod]?: RouteHandler<T>;
    };

    type RouteHandlerWithWebSocketUpgradeObject<T extends string> = {
      [K in HTTPMethod]?: RouteHandlerWithWebSocketUpgrade<T>;
    };

    type RouteValue<T extends string> = Response | false | RouteHandler<T> | RouteHandlerObject<T> | HTMLBundle;
    type RouteValueWithWebSocketUpgrade<T extends string> =
      | RouteValue<T>
      | RouteHandlerWithWebSocketUpgrade<T>
      | RouteHandlerWithWebSocketUpgradeObject<T>;
  }

  interface BunRequest<T extends string = string> extends Request {
    params: RouterTypes.ExtractRouteParams<T>;
    readonly cookies: CookieMap;

    clone(): BunRequest<T>;
  }

  interface GenericServeOptions {
    /**
     * What URI should be used to make {@link Request.url} absolute?
     *
     * By default, looks at {@link hostname}, {@link port}, and whether or not SSL is enabled to generate one
     *
     * @example
     * ```js
     * "http://my-app.com"
     * ```
     *
     * @example
     * ```js
     * "https://wongmjane.com/"
     * ```
     *
     * This should be the public, absolute URL – include the protocol and {@link hostname}. If the port isn't 80 or 443, then include the {@link port} too.
     *
     * @example
     * "http://localhost:3000"
     */
    // baseURI?: string;

    /**
     * What is the maximum size of a request body? (in bytes)
     * @default 1024 * 1024 * 128 // 128MB
     */
    maxRequestBodySize?: number;

    /**
     * Render contextual errors? This enables bun's error page
     * @default process.env.NODE_ENV !== 'production'
     */
    development?:
      | boolean
      | {
          /**
           * Enable Hot Module Replacement for routes (including React Fast Refresh, if React is in use)
           *
           * @default true if process.env.NODE_ENV !== 'production'
           *
           */
          hmr?: boolean;

          /**
           * Enable console log streaming from browser to server
           * @default false
           */
          console?: boolean;

          /**
           * Enable automatic workspace folders for Chrome DevTools
           *
           * This lets you persistently edit files in the browser. It works by adding the following route to the server:
           * `/.well-known/appspecific/com.chrome.devtools.json`
           *
           * The response is a JSON object with the following shape:
           * ```json
           * {
           *   "workspace": {
           *     "root": "<cwd>",
           *     "uuid": "<uuid>"
           *   }
           * }
           * ```
           *
           * The `root` field is the current working directory of the server.
           * The `"uuid"` field is a hash of the file that started the server and a hash of the current working directory.
           *
           * For security reasons, if the remote socket address is not from localhost, 127.0.0.1, or ::1, the request is ignored.
           * @default true
           */
          chromeDevToolsAutomaticWorkspaceFolders?: boolean;
        };

    error?: (this: Server, error: ErrorLike) => Response | Promise<Response> | void | Promise<void>;

    /**
     * Uniquely identify a server instance with an ID
     *
     * ---
     *
     * **When bun is started with the `--hot` flag**:
     *
     * This string will be used to hot reload the server without interrupting
     * pending requests or websockets. If not provided, a value will be
     * generated. To disable hot reloading, set this value to `null`.
     *
     * **When bun is not started with the `--hot` flag**:
     *
     * This string will currently do nothing. But in the future it could be useful for logs or metrics.
     */
    id?: string | null;
  }

  interface ServeOptions extends GenericServeOptions {
    /**
     * What port should the server listen on?
     * @default process.env.PORT || "3000"
     */
    port?: string | number;

    /**
     * Whether the `SO_REUSEPORT` flag should be set.
     *
     * This allows multiple processes to bind to the same port, which is useful for load balancing.
     *
     * @default false
     */
    reusePort?: boolean;

    /**
     * Whether the `IPV6_V6ONLY` flag should be set.
     * @default false
     */
    ipv6Only?: boolean;

    /**
     * What hostname should the server listen on?
     *
     * @default
     * ```js
     * "0.0.0.0" // listen on all interfaces
     * ```
     * @example
     *  ```js
     * "127.0.0.1" // Only listen locally
     * ```
     * @example
     * ```js
     * "remix.run" // Only listen on remix.run
     * ````
     *
     * note: hostname should not include a {@link port}
     */
    hostname?: string;

    /**
     * If set, the HTTP server will listen on a unix socket instead of a port.
     * (Cannot be used with hostname+port)
     */
    unix?: never;

    /**
     * Sets the the number of seconds to wait before timing out a connection
     * due to inactivity.
     *
     * Default is `10` seconds.
     */
    idleTimeout?: number;

    /**
     * Handle HTTP requests
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     */
    fetch(this: Server, request: Request, server: Server): Response | Promise<Response>;
  }

  interface UnixServeOptions extends GenericServeOptions {
    /**
     * If set, the HTTP server will listen on a unix socket instead of a port.
     * (Cannot be used with hostname+port)
     */
    unix: string;
    /**
     * Handle HTTP requests
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     */
    fetch(this: Server, request: Request, server: Server): Response | Promise<Response>;
  }

  interface WebSocketServeOptions<WebSocketDataType = undefined> extends GenericServeOptions {
    /**
     * What port should the server listen on?
     * @default process.env.PORT || "3000"
     */
    port?: string | number;

    /**
     * What hostname should the server listen on?
     *
     * @default
     * ```js
     * "0.0.0.0" // listen on all interfaces
     * ```
     * @example
     *  ```js
     * "127.0.0.1" // Only listen locally
     * ```
     * @example
     * ```js
     * "remix.run" // Only listen on remix.run
     * ````
     *
     * note: hostname should not include a {@link port}
     */
    hostname?: string;

    /**
     * Enable websockets with {@link Bun.serve}
     *
     * For simpler type safety, see {@link Bun.websocket}
     *
     * @example
     * ```js
     * Bun.serve({
     *  websocket: {
     *    open: (ws) => {
     *      console.log("Client connected");
     *    },
     *    message: (ws, message) => {
     *      console.log("Client sent message", message);
     *    },
     *    close: (ws) => {
     *      console.log("Client disconnected");
     *    },
     *  },
     *  fetch(req, server) {
     *    const url = new URL(req.url);
     *    if (url.pathname === "/chat") {
     *      const upgraded = server.upgrade(req);
     *      if (!upgraded) {
     *        return new Response("Upgrade failed", { status: 400 });
     *      }
     *    }
     *    return new Response("Hello World");
     *  },
     * });
     * ```
     * Upgrade a {@link Request} to a {@link ServerWebSocket} via {@link Server.upgrade}
     *
     * Pass `data` in @{link Server.upgrade} to attach data to the {@link ServerWebSocket.data} property
     */
    websocket: WebSocketHandler<WebSocketDataType>;

    /**
     * Handle HTTP requests or upgrade them to a {@link ServerWebSocket}
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     */
    fetch(
      this: Server,
      request: Request,
      server: Server,
    ): Response | undefined | void | Promise<Response | undefined | void>;
  }

  interface UnixWebSocketServeOptions<WebSocketDataType = undefined> extends GenericServeOptions {
    /**
     * If set, the HTTP server will listen on a unix socket instead of a port.
     * (Cannot be used with hostname+port)
     */
    unix: string;

    /**
     * Enable websockets with {@link Bun.serve}
     *
     * For simpler type safety, see {@link Bun.websocket}
     *
     * @example
     * ```js
     * import { serve } from "bun";
     * serve({
     *  websocket: {
     *    open: (ws) => {
     *      console.log("Client connected");
     *    },
     *    message: (ws, message) => {
     *      console.log("Client sent message", message);
     *    },
     *    close: (ws) => {
     *      console.log("Client disconnected");
     *    },
     *  },
     *  fetch(req, server) {
     *    const url = new URL(req.url);
     *    if (url.pathname === "/chat") {
     *      const upgraded = server.upgrade(req);
     *      if (!upgraded) {
     *        return new Response("Upgrade failed", { status: 400 });
     *      }
     *    }
     *    return new Response("Hello World");
     *  },
     * });
     * ```
     * Upgrade a {@link Request} to a {@link ServerWebSocket} via {@link Server.upgrade}
     *
     * Pass `data` in @{link Server.upgrade} to attach data to the {@link ServerWebSocket.data} property
     */
    websocket: WebSocketHandler<WebSocketDataType>;

    /**
     * Handle HTTP requests or upgrade them to a {@link ServerWebSocket}
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     */
    fetch(this: Server, request: Request, server: Server): Response | undefined | Promise<Response | undefined>;
  }

  interface TLSWebSocketServeOptions<WebSocketDataType = undefined>
    extends WebSocketServeOptions<WebSocketDataType>,
      TLSOptionsAsDeprecated {
    unix?: never;
    tls?: TLSOptions | TLSOptions[];
  }

  interface UnixTLSWebSocketServeOptions<WebSocketDataType = undefined>
    extends UnixWebSocketServeOptions<WebSocketDataType>,
      TLSOptionsAsDeprecated {
    /**
     * If set, the HTTP server will listen on a unix socket instead of a port.
     * (Cannot be used with hostname+port)
     */
    unix: string;
    tls?: TLSOptions | TLSOptions[];
  }

  interface TLSServeOptions extends ServeOptions, TLSOptionsAsDeprecated {
    tls?: TLSOptions | TLSOptions[];
  }

  interface UnixTLSServeOptions extends UnixServeOptions, TLSOptionsAsDeprecated {
    tls?: TLSOptions | TLSOptions[];
  }

  interface ErrorLike extends Error {
    code?: string;
    errno?: number;
    syscall?: string;
  }

  /**
   * Options for TLS connections
   */
  interface TLSOptions {
    /**
     * Passphrase for the TLS key
     */
    passphrase?: string;

    /**
     * File path to a .pem file custom Diffie Helman parameters
     */
    dhParamsFile?: string;

    /**
     * Explicitly set a server name
     */
    serverName?: string;

    /**
     * This sets `OPENSSL_RELEASE_BUFFERS` to 1.
     * It reduces overall performance but saves some memory.
     * @default false
     */
    lowMemoryMode?: boolean;

    /**
     * If set to `false`, any certificate is accepted.
     * Default is `$NODE_TLS_REJECT_UNAUTHORIZED` environment variable, or `true` if it is not set.
     */
    rejectUnauthorized?: boolean;

    /**
     * If set to `true`, the server will request a client certificate.
     *
     * Default is `false`.
     */
    requestCert?: boolean;

    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     */
    ca?: string | BufferSource | BunFile | Array<string | BufferSource | BunFile> | undefined;
    /**
     *  Cert chains in PEM format. One cert chain should be provided per
     *  private key. Each cert chain should consist of the PEM formatted
     *  certificate for a provided private key, followed by the PEM
     *  formatted intermediate certificates (if any), in order, and not
     *  including the root CA (the root CA must be pre-known to the peer,
     *  see ca). When providing multiple cert chains, they do not have to
     *  be in the same order as their private keys in key. If the
     *  intermediate certificates are not provided, the peer will not be
     *  able to validate the certificate, and the handshake will fail.
     */
    cert?: string | BufferSource | BunFile | Array<string | BufferSource | BunFile> | undefined;
    /**
     * Private keys in PEM format. PEM allows the option of private keys
     * being encrypted. Encrypted keys will be decrypted with
     * options.passphrase. Multiple keys using different algorithms can be
     * provided either as an array of unencrypted key strings or buffers,
     * or an array of objects in the form {pem: <string|buffer>[,
     * passphrase: <string>]}. The object form can only occur in an array.
     * object.passphrase is optional. Encrypted keys will be decrypted with
     * object.passphrase if provided, or options.passphrase if it is not.
     */
    key?: string | BufferSource | BunFile | Array<string | BufferSource | BunFile> | undefined;
    /**
     * Optionally affect the OpenSSL protocol behavior, which is not
     * usually necessary. This should be used carefully if at all! Value is
     * a numeric bitmask of the SSL_OP_* options from OpenSSL Options
     */
    secureOptions?: number | undefined; // Value is a numeric bitmask of the `SSL_OP_*` options

    keyFile?: string;

    certFile?: string;

    ALPNProtocols?: string | BufferSource;

    ciphers?: string;

    clientRenegotiationLimit?: number;

    clientRenegotiationWindow?: number;
  }

  // Note for contributors: TLSOptionsAsDeprecated should be considered immutable
  // and new TLS option keys should only be supported on the `.tls` property (which comes
  // from the TLSOptions interface above).
  /**
   * This exists because Bun.serve() extends the TLSOptions object, but
   * they're now considered deprecated. You should be passing the
   * options on `.tls` instead.
   *
   * @example
   * ```ts
   * //// OLD ////
   * Bun.serve({
   *   fetch: () => new Response("Hello World"),
   *   passphrase: "secret",
   * });
   *
   * //// NEW ////
   * Bun.serve({
   *   fetch: () => new Response("Hello World"),
   *   tls: {
   *     passphrase: "secret",
   *   },
   * });
   * ```
   */
  interface TLSOptionsAsDeprecated {
    /**
     * Passphrase for the TLS key
     *
     * @deprecated Use `.tls.passphrase` instead
     */
    passphrase?: string;

    /**
     * File path to a .pem file custom Diffie Helman parameters
     *
     * @deprecated Use `.tls.dhParamsFile` instead
     */
    dhParamsFile?: string;

    /**
     * Explicitly set a server name
     *
     * @deprecated Use `.tls.serverName` instead
     */
    serverName?: string;

    /**
     * This sets `OPENSSL_RELEASE_BUFFERS` to 1.
     * It reduces overall performance but saves some memory.
     * @default false
     *
     * @deprecated Use `.tls.lowMemoryMode` instead
     */
    lowMemoryMode?: boolean;

    /**
     * If set to `false`, any certificate is accepted.
     * Default is `$NODE_TLS_REJECT_UNAUTHORIZED` environment variable, or `true` if it is not set.
     *
     * @deprecated Use `.tls.rejectUnauthorized` instead
     */
    rejectUnauthorized?: boolean;

    /**
     * If set to `true`, the server will request a client certificate.
     *
     * Default is `false`.
     *
     * @deprecated Use `.tls.requestCert` instead
     */
    requestCert?: boolean;

    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     *
     * @deprecated Use `.tls.ca` instead
     */
    ca?: string | Buffer | BunFile | Array<string | Buffer | BunFile> | undefined;
    /**
     *  Cert chains in PEM format. One cert chain should be provided per
     *  private key. Each cert chain should consist of the PEM formatted
     *  certificate for a provided private key, followed by the PEM
     *  formatted intermediate certificates (if any), in order, and not
     *  including the root CA (the root CA must be pre-known to the peer,
     *  see ca). When providing multiple cert chains, they do not have to
     *  be in the same order as their private keys in key. If the
     *  intermediate certificates are not provided, the peer will not be
     *  able to validate the certificate, and the handshake will fail.
     *
     * @deprecated Use `.tls.cert` instead
     */
    cert?: string | Buffer | BunFile | Array<string | Buffer | BunFile> | undefined;
    /**
     * Private keys in PEM format. PEM allows the option of private keys
     * being encrypted. Encrypted keys will be decrypted with
     * options.passphrase. Multiple keys using different algorithms can be
     * provided either as an array of unencrypted key strings or buffers,
     * or an array of objects in the form {pem: <string|buffer>[,
     * passphrase: <string>]}. The object form can only occur in an array.
     * object.passphrase is optional. Encrypted keys will be decrypted with
     * object.passphrase if provided, or options.passphrase if it is not.
     *
     * @deprecated Use `.tls.key` instead
     */
    key?: string | Buffer | BunFile | Array<string | Buffer | BunFile> | undefined;
    /**
     * Optionally affect the OpenSSL protocol behavior, which is not
     * usually necessary. This should be used carefully if at all! Value is
     * a numeric bitmask of the SSL_OP_* options from OpenSSL Options
     *
     * @deprecated `Use .tls.secureOptions` instead
     */
    secureOptions?: number | undefined; // Value is a numeric bitmask of the `SSL_OP_*` options
  }

  interface SocketAddress {
    /**
     * The IP address of the client.
     */
    address: string;
    /**
     * The port of the client.
     */
    port: number;
    /**
     * The IP family ("IPv4" or "IPv6").
     */
    family: "IPv4" | "IPv6";
  }

  /**
   * HTTP & HTTPS Server
   *
   * To start the server, see {@link serve}
   *
   * For performance, Bun pre-allocates most of the data for 2048 concurrent requests.
   * That means starting a new server allocates about 500 KB of memory. Try to
   * avoid starting and stopping the server often (unless it's a new instance of bun).
   *
   * Powered by a fork of [uWebSockets](https://github.com/uNetworking/uWebSockets). Thank you \@alexhultman.
   *
   * @category HTTP & Networking
   */
  interface Server extends Disposable {
    /**
     * Stop listening to prevent new connections from being accepted.
     *
     * By default, it does not cancel in-flight requests or websockets. That means it may take some time before all network activity stops.
     *
     * @param closeActiveConnections Immediately terminate in-flight requests, websockets, and stop accepting new connections.
     * @default false
     */
    stop(closeActiveConnections?: boolean): Promise<void>;

    /**
     * Update the `fetch` and `error` handlers without restarting the server.
     *
     * This is useful if you want to change the behavior of your server without
     * restarting it or for hot reloading.
     *
     * @example
     *
     * ```js
     * // create the server
     * const server = Bun.serve({
     *  fetch(request) {
     *    return new Response("Hello World v1")
     *  }
     * });
     *
     * // Update the server to return a different response
     * server.reload({
     *   fetch(request) {
     *     return new Response("Hello World v2")
     *   }
     * });
     * ```
     *
     * Passing other options such as `port` or `hostname` won't do anything.
     */
    reload<T, R extends { [K in keyof R]: RouterTypes.RouteValue<K & string> }>(
      options: ServeFunctionOptions<T, R> & {
        /**
         * @deprecated Use `routes` instead in new code. This will continue to work for awhile though.
         */
        static?: R;
      },
    ): Server;

    /**
     * Mock the fetch handler for a running server.
     *
     * This feature is not fully implemented yet. It doesn't normalize URLs
     * consistently in all cases and it doesn't yet call the `error` handler
     * consistently. This needs to be fixed
     */
    fetch(request: Request | string): Response | Promise<Response>;

    /**
     * Upgrade a {@link Request} to a {@link ServerWebSocket}
     *
     * @param request The {@link Request} to upgrade
     * @param options Pass headers or attach data to the {@link ServerWebSocket}
     *
     * @returns `true` if the upgrade was successful and `false` if it failed
     *
     * @example
     * ```js
     * import { serve } from "bun";
     *  serve({
     *    websocket: {
     *      open: (ws) => {
     *        console.log("Client connected");
     *      },
     *      message: (ws, message) => {
     *        console.log("Client sent message", message);
     *      },
     *      close: (ws) => {
     *        console.log("Client disconnected");
     *      },
     *    },
     *    fetch(req, server) {
     *      const url = new URL(req.url);
     *      if (url.pathname === "/chat") {
     *        const upgraded = server.upgrade(req);
     *        if (!upgraded) {
     *          return new Response("Upgrade failed", { status: 400 });
     *        }
     *      }
     *      return new Response("Hello World");
     *    },
     *  });
     * ```
     *  What you pass to `data` is available on the {@link ServerWebSocket.data} property
     */
    // eslint-disable-next-line @definitelytyped/no-unnecessary-generics
    upgrade<T = undefined>(
      request: Request,
      options?: {
        /**
         * Send any additional headers while upgrading, like cookies
         */
        headers?: HeadersInit;
        /**
         * This value is passed to the {@link ServerWebSocket.data} property
         */
        data?: T;
      },
    ): boolean;

    /**
     * Send a message to all connected {@link ServerWebSocket} subscribed to a topic
     *
     * @param topic The topic to publish to
     * @param data The data to send
     * @param compress Should the data be compressed? Ignored if the client does not support compression.
     *
     * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
     *
     * @example
     *
     * ```js
     * server.publish("chat", "Hello World");
     * ```
     *
     * @example
     * ```js
     * server.publish("chat", new Uint8Array([1, 2, 3, 4]));
     * ```
     *
     * @example
     * ```js
     * server.publish("chat", new ArrayBuffer(4), true);
     * ```
     *
     * @example
     * ```js
     * server.publish("chat", new DataView(new ArrayBuffer(4)));
     * ```
     */
    publish(
      topic: string,
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      compress?: boolean,
    ): ServerWebSocketSendStatus;

    /**
     * A count of connections subscribed to a given topic
     *
     * This operation will loop through each topic internally to get the count.
     *
     * @param topic the websocket topic to check how many subscribers are connected to
     * @returns the number of subscribers
     */
    subscriberCount(topic: string): number;

    /**
     * Returns the client IP address and port of the given Request. If the request was closed or is a unix socket, returns null.
     *
     * @example
     * ```js
     * export default {
     *  async fetch(request, server) {
     *    return new Response(server.requestIP(request));
     *  }
     * }
     * ```
     */
    requestIP(request: Request): SocketAddress | null;

    /**
     * Reset the idleTimeout of the given Request to the number in seconds. 0 means no timeout.
     *
     * @example
     * ```js
     * export default {
     *  async fetch(request, server) {
     *    server.timeout(request, 60);
     *    await Bun.sleep(30000);
     *    return new Response("30 seconds have passed");
     *  }
     * }
     * ```
     */
    timeout(request: Request, seconds: number): void;
    /**
     * Undo a call to {@link Server.unref}
     *
     * If the Server has already been stopped, this does nothing.
     *
     * If {@link Server.ref} is called multiple times, this does nothing. Think of it as a boolean toggle.
     */
    ref(): void;

    /**
     * Don't keep the process alive if this server is the only thing left.
     * Active connections may continue to keep the process alive.
     *
     * By default, the server is ref'd.
     *
     * To prevent new connections from being accepted, use {@link Server.stop}
     */
    unref(): void;

    /**
     * How many requests are in-flight right now?
     */
    readonly pendingRequests: number;

    /**
     * How many {@link ServerWebSocket}s are in-flight right now?
     */
    readonly pendingWebSockets: number;

    readonly url: URL;

    /**
     * The port the server is listening on.
     *
     * This will be undefined when the server is listening on a unix socket.
     *
     * @example
     * ```js
     * 3000
     * ```
     */
    readonly port: number | undefined;

    /**
     * The hostname the server is listening on. Does not include the port.
     *
     * This will be `undefined` when the server is listening on a unix socket.
     *
     * @example
     * ```js
     * "localhost"
     * ```
     */
    readonly hostname: string | undefined;

    /**
     * Is the server running in development mode?
     *
     * In development mode, `Bun.serve()` returns rendered error messages with
     * stack traces instead of a generic 500 error. This makes debugging easier,
     * but development mode shouldn't be used in production or you will risk
     * leaking sensitive information.
     */
    readonly development: boolean;

    /**
     * An identifier of the server instance
     *
     * When bun is started with the `--hot` flag, this ID is used to hot reload the server without interrupting pending requests or websockets.
     *
     * When bun is not started with the `--hot` flag, this ID is currently unused.
     */
    readonly id: string;
  }

  /**
   * The type of options that can be passed to {@link serve}
   */
  type Serve<WebSocketDataType = undefined> =
    | ServeOptions
    | TLSServeOptions
    | UnixServeOptions
    | UnixTLSServeOptions
    | WebSocketServeOptions<WebSocketDataType>
    | TLSWebSocketServeOptions<WebSocketDataType>
    | UnixWebSocketServeOptions<WebSocketDataType>
    | UnixTLSWebSocketServeOptions<WebSocketDataType>;

  /**
   * The type of options that can be passed to {@link serve}, with support for `routes` and a safer requirement for `fetch`
   */
  type ServeFunctionOptions<T, R extends { [K in keyof R]: RouterTypes.RouteValue<Extract<K, string>> }> =
    | (DistributedOmit<Exclude<Serve<T>, WebSocketServeOptions<T>>, "fetch"> & {
        routes: R;
        fetch?: (this: Server, request: Request, server: Server) => Response | Promise<Response>;
      })
    | (DistributedOmit<Exclude<Serve<T>, WebSocketServeOptions<T>>, "routes"> & {
        routes?: never;
        fetch: (this: Server, request: Request, server: Server) => Response | Promise<Response>;
      })
    | (Omit<WebSocketServeOptions<T>, "fetch"> & {
        routes: {
          [K in keyof R]: RouterTypes.RouteValueWithWebSocketUpgrade<Extract<K, string>>;
        };
        fetch?: (
          this: Server,
          request: Request,
          server: Server,
        ) => Response | Promise<Response | void | undefined> | void | undefined;
      })
    | (Omit<WebSocketServeOptions<T>, "fetch"> & {
        routes?: never;
        fetch: (
          this: Server,
          request: Request,
          server: Server,
        ) => Response | Promise<Response | void | undefined> | void | undefined;
      });

  /**
   * Bun.serve provides a high-performance HTTP server with built-in routing support.
   * It enables both function-based and object-based route handlers with type-safe
   * parameters and method-specific handling.
   *
   * @param options - Server configuration options
   *
   * @category HTTP & Networking
   *
   * @example Basic Usage
   * ```ts
   * Bun.serve({
   *   port: 3000,
   *   fetch(req) {
   *     return new Response("Hello World");
   *   }
   * });
   * ```
   *
   * @example Route-based Handlers
   * ```ts
   * Bun.serve({
   *   routes: {
   *     // Static responses
   *     "/": new Response("Home page"),
   *
   *     // Function handlers with type-safe parameters
   *     "/users/:id": (req) => {
   *       // req.params.id is typed as string
   *       return new Response(`User ${req.params.id}`);
   *     },
   *
   *     // Method-specific handlers
   *     "/api/posts": {
   *       GET: () => new Response("Get posts"),
   *       POST: async (req) => {
   *         const body = await req.json();
   *         return new Response("Created post");
   *       },
   *       DELETE: (req) => new Response("Deleted post")
   *     },
   *
   *     // Wildcard routes
   *     "/static/*": (req) => {
   *       // Handle any path under /static/
   *       return new Response("Static file");
   *     },
   *
   *     // Disable route (fall through to fetch handler)
   *     "/api/legacy": false
   *   },
   *
   *   // Fallback handler for unmatched routes
   *   fetch(req) {
   *     return new Response("Not Found", { status: 404 });
   *   }
   * });
   * ```
   *
   * @example Path Parameters
   * ```ts
   * Bun.serve({
   *   routes: {
   *     // Single parameter
   *     "/users/:id": (req: BunRequest<"/users/:id">) => {
   *       return new Response(`User ID: ${req.params.id}`);
   *     },
   *
   *     // Multiple parameters
   *     "/posts/:postId/comments/:commentId": (
   *       req: BunRequest<"/posts/:postId/comments/:commentId">
   *     ) => {
   *       return new Response(JSON.stringify(req.params));
   *       // Output: {"postId": "123", "commentId": "456"}
   *     }
   *   }
   * });
   * ```
   *
   * @example Route Precedence
   * ```ts
   * // Routes are matched in the following order:
   * // 1. Exact static routes ("/about")
   * // 2. Parameter routes ("/users/:id")
   * // 3. Wildcard routes ("/api/*")
   *
   * Bun.serve({
   *   routes: {
   *     "/api/users": () => new Response("Users list"),
   *     "/api/users/:id": (req) => new Response(`User ${req.params.id}`),
   *     "/api/*": () => new Response("API catchall"),
   *     "/*": () => new Response("Root catchall")
   *   }
   * });
   * ```
   *
   * @example Error Handling
   * ```ts
   * Bun.serve({
   *   routes: {
   *     "/error": () => {
   *       throw new Error("Something went wrong");
   *     }
   *   },
   *   error(error) {
   *     // Custom error handler
   *     console.error(error);
   *     return new Response(`Error: ${error.message}`, {
   *       status: 500
   *     });
   *   }
   * });
   * ```
   *
   * @example Server Lifecycle
   * ```ts
   * const server = Bun.serve({
   *   // Server config...
   * });
   *
   * // Update routes at runtime
   * server.reload({
   *   routes: {
   *     "/": () => new Response("Updated route")
   *   }
   * });
   *
   * // Stop the server
   * server.stop();
   * ```
   *
   * @example Development Mode
   * ```ts
   * Bun.serve({
   *   development: true, // Enable hot reloading
   *   routes: {
   *     // Routes will auto-reload on changes
   *   }
   * });
   * ```
   *
   * @example Type-Safe Request Handling
   * ```ts
   * type Post = {
   *   id: string;
   *   title: string;
   * };
   *
   * Bun.serve({
   *   routes: {
   *     "/api/posts/:id": async (
   *       req: BunRequest<"/api/posts/:id">
   *     ) => {
   *       if (req.method === "POST") {
   *         const body: Post = await req.json();
   *         return Response.json(body);
   *       }
   *       return new Response("Method not allowed", {
   *         status: 405
   *       });
   *     }
   *   }
   * });
   * ```
   */
  function serve<T, R extends { [K in keyof R]: RouterTypes.RouteValue<K & string> }>(
    options: ServeFunctionOptions<T, R> & {
      /**
       * @deprecated Use `routes` instead in new code. This will continue to work for a while though.
       */
      static?: R;
    },
  ): Server;

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   * - `type` is auto-set based on the file extension when possible
   *
   * @example
   * ```js
   * const file = Bun.file("./hello.json");
   * console.log(file.type); // "application/json"
   * console.log(await file.json()); // { hello: "world" }
   * ```
   *
   * @example
   * ```js
   * await Bun.write(
   *   Bun.file("./hello.txt"),
   *   "Hello, world!"
   * );
   * ```
   * @param path The path to the file (lazily loaded) if the path starts with `s3://` it will behave like {@link S3File}
   */
  function file(path: string | URL, options?: BlobPropertyBag): BunFile;

  /**
   * A list of files embedded into the standalone executable. Lexigraphically sorted by name.
   *
   * If the process is not a standalone executable, this returns an empty array.
   */
  const embeddedFiles: ReadonlyArray<Blob>;

  /**
   * `Blob` that leverages the fastest system calls available to operate on files.
   *
   * This Blob is lazy. It won't do any work until you read from it. Errors propagate as promise rejections.
   *
   * `Blob.size` will not be valid until the contents of the file are read at least once.
   * `Blob.type` will have a default set based on the file extension
   *
   * @example
   * ```js
   * const file = Bun.file(new TextEncoder.encode("./hello.json"));
   * console.log(file.type); // "application/json"
   * ```
   *
   * @param path The path to the file as a byte buffer (the buffer is copied) if the path starts with `s3://` it will behave like {@link S3File}
   */
  function file(path: ArrayBufferLike | Uint8Array, options?: BlobPropertyBag): BunFile;

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   *
   * @example
   * ```js
   * const file = Bun.file(fd);
   * ```
   *
   * @param fileDescriptor The file descriptor of the file
   */
  function file(fileDescriptor: number, options?: BlobPropertyBag): BunFile;

  /**
   * Allocate a new [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) without zeroing the bytes.
   *
   * This can be 3.5x faster than `new Uint8Array(size)`, but if you send uninitialized memory to your users (even unintentionally), it can potentially leak anything recently in memory.
   */
  function allocUnsafe(size: number): Uint8Array;

  /**
   * Options for `Bun.inspect`
   */
  interface BunInspectOptions {
    /**
     * Whether to colorize the output
     */
    colors?: boolean;
    /**
     * The depth of the inspection
     */
    depth?: number;
    /**
     * Whether to sort the properties of the object
     */
    sorted?: boolean;
    /**
     * Whether to compact the output
     */
    compact?: boolean;
  }

  type WebSocketOptionsProtocolsOrProtocol =
    | {
        /**
         * Protocols to use for the WebSocket connection
         */
        protocols?: string | string[];
      }
    | {
        /**
         * Protocol to use for the WebSocket connection
         */
        protocol?: string;
      };

  type WebSocketOptionsTLS = {
    /**
     * Options for the TLS connection
     */
    tls?: {
      /**
       * Whether to reject the connection if the certificate is not valid
       *
       * @default true
       */
      rejectUnauthorized?: boolean;
    };
  };

  type WebSocketOptionsHeaders = {
    /**
     * Headers to send to the server
     */
    headers?: import("node:http").OutgoingHttpHeaders;
  };

  /**
   * Constructor options for the `Bun.WebSocket` client
   */
  type WebSocketOptions = WebSocketOptionsProtocolsOrProtocol & WebSocketOptionsTLS & WebSocketOptionsHeaders;

  interface WebSocketEventMap {
    close: CloseEvent;
    error: Event;
    message: MessageEvent;
    open: Event;
  }

  /**
   * A WebSocket client implementation
   *
   * @example
   * ```ts
   * const ws = new WebSocket("ws://localhost:8080", {
   *  headers: {
   *    "x-custom-header": "hello",
   *  },
   * });
   *
   * ws.addEventListener("open", () => {
   *   console.log("Connected to server");
   * });
   *
   * ws.addEventListener("message", (event) => {
   *   console.log("Received message:", event.data);
   * });
   *
   * ws.send("Hello, server!");
   * ws.terminate();
   * ```
   */
  interface WebSocket extends EventTarget {
    /**
     * The URL of the WebSocket connection
     */
    readonly url: string;

    /**
     * Legacy URL property (same as url)
     * @deprecated Use url instead
     */
    readonly URL: string;

    /**
     * The current state of the connection
     */
    readonly readyState:
      | typeof WebSocket.CONNECTING
      | typeof WebSocket.OPEN
      | typeof WebSocket.CLOSING
      | typeof WebSocket.CLOSED;

    /**
     * The number of bytes of data that have been queued using send() but not yet transmitted to the network
     */
    readonly bufferedAmount: number;

    /**
     * The protocol selected by the server
     */
    readonly protocol: string;

    /**
     * The extensions selected by the server
     */
    readonly extensions: string;

    /**
     * The type of binary data being received.
     */
    binaryType: "arraybuffer" | "nodebuffer";

    /**
     * Event handler for open event
     */
    onopen: ((this: WebSocket, ev: Event) => any) | null;

    /**
     * Event handler for message event
     */
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;

    /**
     * Event handler for error event
     */
    onerror: ((this: WebSocket, ev: Event) => any) | null;

    /**
     * Event handler for close event
     */
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;

    /**
     * Transmits data to the server
     * @param data The data to send to the server
     */
    send(data: string | ArrayBufferLike | ArrayBufferView): void;

    /**
     * Closes the WebSocket connection
     * @param code A numeric value indicating the status code
     * @param reason A human-readable string explaining why the connection is closing
     */
    close(code?: number, reason?: string): void;

    /**
     * Sends a ping frame to the server
     * @param data Optional data to include in the ping frame
     */
    ping(data?: string | ArrayBufferLike | ArrayBufferView): void;

    /**
     * Sends a pong frame to the server
     * @param data Optional data to include in the pong frame
     */
    pong(data?: string | ArrayBufferLike | ArrayBufferView): void;

    /**
     * Immediately terminates the connection
     */
    terminate(): void;

    /**
     * Registers an event handler of a specific event type on the WebSocket.
     * @param type A case-sensitive string representing the event type to listen for
     * @param listener The function to be called when the event occurs
     * @param options An options object that specifies characteristics about the event listener
     */
    addEventListener<K extends keyof WebSocketEventMap>(
      type: K,
      listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;

    /**
     * Removes an event listener previously registered with addEventListener()
     * @param type A case-sensitive string representing the event type to remove
     * @param listener The function to remove from the event target
     * @param options An options object that specifies characteristics about the event listener
     */
    removeEventListener<K extends keyof WebSocketEventMap>(
      type: K,
      listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
      options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void;

    /** @deprecated Use instance property instead */
    readonly CONNECTING: 0;
    /** @deprecated Use instance property instead */
    readonly OPEN: 1;
    /** @deprecated Use instance property instead */
    readonly CLOSING: 2;
    /** @deprecated Use instance property instead */
    readonly CLOSED: 3;
  }

  /**
   * Pretty-print an object the same as {@link console.log} to a `string`
   *
   * Supports JSX
   *
   * @param arg The value to inspect
   * @param options Options for the inspection
   */
  function inspect(arg: any, options?: BunInspectOptions): string;
  namespace inspect {
    /**
     * That can be used to declare custom inspect functions.
     */
    const custom: typeof import("util").inspect.custom;

    /**
     * Pretty-print an object or array as a table
     *
     * Like {@link console.table}, except it returns a string
     */
    function table(tabularData: object | unknown[], properties?: string[], options?: { colors?: boolean }): string;
    function table(tabularData: object | unknown[], options?: { colors?: boolean }): string;
  }

  interface MMapOptions {
    /**
     * Sets MAP_SYNC flag on Linux. Ignored on macOS due to lack of support.
     */
    sync?: boolean;
    /**
     * Allow other processes to see results instantly?
     * This enables MAP_SHARED. If false, it enables MAP_PRIVATE.
     * @default true
     */
    shared?: boolean;
  }
  /**
   * Open a file as a live-updating `Uint8Array` without copying memory
   * - Writing to the array writes to the file.
   * - Reading from the array reads from the file.
   *
   * This uses the [`mmap()`](https://man7.org/linux/man-pages/man2/mmap.2.html) syscall under the hood.
   *
   * ---
   *
   * This API inherently has some rough edges:
   * - It does not support empty files. It will throw a `SystemError` with `EINVAL`
   * - Usage on shared/networked filesystems is discouraged. It will be very slow.
   * - If you delete or truncate the file, that will crash bun. This is called a segmentation fault.
   *
   * ---
   *
   * To close the file, set the array to `null` and it will be garbage collected eventually.
   */
  function mmap(path: PathLike, opts?: MMapOptions): Uint8Array;

  /**
   * Write to stdout
   */
  const stdout: BunFile;

  /**
   * Write to stderr
   */
  const stderr: BunFile;

  /**
   * Read from stdin
   *
   * This is a read-only BunFile
   */
  const stdin: BunFile;

  type StringLike = string | { toString(): string };

  /**
   * Valid inputs for {@link color}
   *
   * @category Utilities
   */
  type ColorInput =
    | { r: number; g: number; b: number; a?: number }
    | [number, number, number]
    | [number, number, number, number]
    | Uint8Array
    | Uint8ClampedArray
    | Float32Array
    | Float64Array
    | string
    | number
    | { toString(): string };

  /**
   * Converts formats of colors
   *
   * @category Utilities
   *
   * @param input A value that could possibly be a color
   * @param outputFormat An optional output format
   */
  function color(
    input: ColorInput,
    outputFormat?: /**
     * True color ANSI color string, for use in terminals
     * @example \x1b[38;2;100;200;200m
     */
    | "ansi"
      | "ansi-16"
      | "ansi-16m"
      /**
       * 256 color ANSI color string, for use in terminals which don't support true color
       *
       * Tries to match closest 24-bit color to 256 color palette
       */
      | "ansi-256"
      /**
       * Picks the format that produces the shortest output
       */
      | "css"
      /**
       * Lowercase hex color string without alpha
       * @example #ff9800
       */
      | "hex"
      /**
       * Uppercase hex color string without alpha
       * @example #FF9800
       */
      | "HEX"
      /**
       * @example hsl(35.764706, 1, 0.5)
       */
      | "hsl"
      /**
       * @example lab(0.72732764, 33.938198, -25.311619)
       */
      | "lab"
      /**
       * @example 16750592
       */
      | "number"
      /**
       * RGB color string without alpha
       * @example rgb(255, 152, 0)
       */
      | "rgb"
      /**
       * RGB color string with alpha
       * @example rgba(255, 152, 0, 1)
       */
      | "rgba",
  ): string | null;

  /**
   * Convert any color input to rgb
   * @param input Any color input
   * @param outputFormat Specify `[rgb]` to output as an array with `r`, `g`, and `b` properties
   */
  function color(input: ColorInput, outputFormat: "[rgb]"): [number, number, number] | null;
  /**
   * Convert any color input to rgba
   * @param input Any color input
   * @param outputFormat Specify `[rgba]` to output as an array with `r`, `g`, `b`, and `a` properties
   */
  function color(input: ColorInput, outputFormat: "[rgba]"): [number, number, number, number] | null;
  /**
   * Convert any color input to a number
   * @param input Any color input
   * @param outputFormat Specify `{rgb}` to output as an object with `r`, `g`, and `b` properties
   */
  function color(input: ColorInput, outputFormat: "{rgb}"): { r: number; g: number; b: number } | null;
  /**
   * Convert any color input to rgba
   * @param input Any color input
   * @param outputFormat Specify {rgba} to output as an object with `r`, `g`, `b`, and `a` properties
   */
  function color(input: ColorInput, outputFormat: "{rgba}"): { r: number; g: number; b: number; a: number } | null;
  /**
   * Convert any color input to a number
   * @param input Any color input
   * @param outputFormat Specify `number` to output as a number
   */
  function color(input: ColorInput, outputFormat: "number"): number | null;

  /**
   * Bun.semver provides a fast way to parse and compare version numbers.
   */
  namespace semver {
    /**
     * Test if the version satisfies the range. Stringifies both arguments. Returns `true` or `false`.
     */
    function satisfies(version: StringLike, range: StringLike): boolean;

    /**
     * Returns 0 if the versions are equal, 1 if `v1` is greater, or -1 if `v2` is greater.
     * Throws an error if either version is invalid.
     */
    function order(v1: StringLike, v2: StringLike): -1 | 0 | 1;
  }

  namespace unsafe {
    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint8Array` or `ArrayBuffer`.
     *
     * **Only use this for ASCII strings**. If there are non-ascii characters, your application may crash and/or very confusing bugs will happen such as `"foo" !== "foo"`.
     *
     * **The input buffer must not be garbage collected**. That means you will need to hold on to it for the duration of the string's lifetime.
     */
    function arrayBufferToString(buffer: Uint8Array | ArrayBufferLike): string;

    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint16Array`
     *
     * **The input must be a UTF-16 encoded string**. This API does no validation whatsoever.
     *
     * **The input buffer must not be garbage collected**. That means you will need to hold on to it for the duration of the string's lifetime.
     */

    function arrayBufferToString(buffer: Uint16Array): string;

    /**
     * Force the garbage collector to run extremely often,
     * especially inside `bun:test`.
     *
     * - `0`: default, disable
     * - `1`: asynchronously call the garbage collector more often
     * - `2`: synchronously call the garbage collector more often.
     *
     * This is a global setting. It's useful for debugging seemingly random crashes.
     *
     * `BUN_GARBAGE_COLLECTOR_LEVEL` environment variable is also supported.
     *
     * @param level
     * @returns The previous level
     */
    function gcAggressionLevel(level?: 0 | 1 | 2): 0 | 1 | 2;

    /**
     * Dump the mimalloc heap to the console
     */
    function mimallocDump(): void;
  }

  type DigestEncoding = "utf8" | "ucs2" | "utf16le" | "latin1" | "ascii" | "base64" | "base64url" | "hex";

  /**
   * Are ANSI colors enabled for stdin and stdout?
   *
   * Used for {@link console.log}
   */
  const enableANSIColors: boolean;

  /**
   * What script launched Bun?
   *
   * Absolute file path
   *
   * @example "/never-gonna-give-you-up.js"
   */
  const main: string;

  /**
   * Manually trigger the garbage collector
   *
   * This does two things:
   * 1. It tells JavaScriptCore to run the garbage collector
   * 2. It tells [mimalloc](https://github.com/microsoft/mimalloc) to clean up fragmented memory. Mimalloc manages the heap not used in JavaScriptCore.
   *
   * @param force Synchronously run the garbage collector
   */
  function gc(force?: boolean): void;

  /**
   * JavaScriptCore engine's internal heap snapshot
   *
   * I don't know how to make this something Chrome or Safari can read.
   *
   * If you have any ideas, please file an issue https://github.com/oven-sh/bun
   */
  interface HeapSnapshot {
    /** 2 */
    version: number;

    /** "Inspector" */
    type: string;

    nodes: number[];

    nodeClassNames: string[];
    edges: number[];
    edgeTypes: string[];
    edgeNames: string[];
  }

  /**
   * Returns the number of nanoseconds since the process was started.
   *
   * This function uses a high-resolution monotonic system timer to provide precise time measurements.
   * In JavaScript, numbers are represented as double-precision floating-point values (IEEE 754),
   * which can safely represent integers up to 2^53 - 1 (Number.MAX_SAFE_INTEGER).
   *
   * Due to this limitation, while the internal counter may continue beyond this point,
   * the precision of the returned value will degrade after 14.8 weeks of uptime (when the nanosecond
   * count exceeds Number.MAX_SAFE_INTEGER). Beyond this point, the function will continue to count but
   * with reduced precision, which might affect time calculations and comparisons in long-running applications.
   *
   * @returns {number} The number of nanoseconds since the process was started, with precise values up to
   * Number.MAX_SAFE_INTEGER.
   */
  function nanoseconds(): number;

  /**
   * Show precise statistics about memory usage of your application
   *
   * Generate a heap snapshot in JavaScriptCore's format that can be viewed with `bun --inspect` or Safari's Web Inspector
   */
  function generateHeapSnapshot(format?: "jsc"): HeapSnapshot;

  /**
   * Show precise statistics about memory usage of your application
   *
   * Generate a V8 Heap Snapshot that can be used with Chrome DevTools & Visual Studio Code
   *
   * This is a JSON string that can be saved to a file.
   * ```ts
   * const snapshot = Bun.generateHeapSnapshot("v8");
   * await Bun.write("heap.heapsnapshot", snapshot);
   * ```
   */
  function generateHeapSnapshot(format: "v8"): string;

  /**
   * The next time JavaScriptCore is idle, clear unused memory and attempt to reduce the heap size.
   *
   * @deprecated
   */
  function shrink(): void;

  /**
   * Open a file in your local editor. Auto-detects via `$VISUAL` || `$EDITOR`
   *
   * @param path path to open
   */
  function openInEditor(path: string, options?: EditorOptions): void;

  var fetch: typeof globalThis.fetch;

  interface EditorOptions {
    editor?: "vscode" | "subl";
    line?: number;
    column?: number;
  }

  /**
   * This class only exists in types
   */
  abstract class CryptoHashInterface<T> {
    /**
     * Update the hash with data
     *
     * @param data
     */
    update(data: Bun.BlobOrStringOrBuffer): T;

    /**
     * Finalize the hash
     *
     * @param encoding `DigestEncoding` to return the hash in. If none is provided, it will return a `Uint8Array`.
     */
    digest(encoding: DigestEncoding): string;

    /**
     * Finalize the hash
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    digest(hashInto?: NodeJS.TypedArray): NodeJS.TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    static hash(input: Bun.BlobOrStringOrBuffer, hashInto?: NodeJS.TypedArray): NodeJS.TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param encoding `DigestEncoding` to return the hash in
     */
    static hash(input: Bun.BlobOrStringOrBuffer, encoding: DigestEncoding): string;
  }

  type SupportedCryptoAlgorithms =
    | "blake2b256"
    | "blake2b512"
    | "md4"
    | "md5"
    | "ripemd160"
    | "sha1"
    | "sha224"
    | "sha256"
    | "sha384"
    | "sha512"
    | "sha512-224"
    | "sha512-256"
    | "sha3-224"
    | "sha3-256"
    | "sha3-384"
    | "sha3-512"
    | "shake128"
    | "shake256";

  /**
   * Hardware-accelerated cryptographic hash functions
   *
   * Used for `crypto.createHash()`
   */
  class CryptoHasher {
    /**
     * The algorithm chosen to hash the data
     */
    readonly algorithm: SupportedCryptoAlgorithms;

    /**
     * The length of the output hash in bytes
     */
    readonly byteLength: number;

    /**
     * Create a new hasher
     *
     * @param algorithm The algorithm to use. See {@link algorithms} for a list of supported algorithms
     * @param hmacKey Optional key for HMAC. Must be a string or `TypedArray`. If not provided, the hasher will be a non-HMAC hasher.
     */
    constructor(algorithm: SupportedCryptoAlgorithms, hmacKey?: string | NodeJS.TypedArray);

    /**
     * Update the hash with data
     *
     * @param input
     */
    update(input: Bun.BlobOrStringOrBuffer, inputEncoding?: import("crypto").Encoding): CryptoHasher;

    /**
     * Perform a deep copy of the hasher
     */
    copy(): CryptoHasher;

    /**
     * Finalize the hash. Resets the CryptoHasher so it can be reused.
     *
     * @param encoding `DigestEncoding` to return the hash in. If none is provided, it will return a `Uint8Array`.
     */
    digest(encoding: DigestEncoding): string;

    /**
     * Finalize the hash and return a `Buffer`
     */
    digest(): Buffer;

    /**
     * Finalize the hash
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    digest(hashInto: NodeJS.TypedArray): NodeJS.TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     */
    static hash(algorithm: SupportedCryptoAlgorithms, input: Bun.BlobOrStringOrBuffer): Buffer;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    static hash(
      algorithm: SupportedCryptoAlgorithms,
      input: Bun.BlobOrStringOrBuffer,
      hashInto: NodeJS.TypedArray,
    ): NodeJS.TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param encoding `DigestEncoding` to return the hash in
     */
    static hash(
      algorithm: SupportedCryptoAlgorithms,
      input: Bun.BlobOrStringOrBuffer,
      encoding: DigestEncoding,
    ): string;

    /**
     * List of supported hash algorithms
     *
     * These are hardware accelerated with BoringSSL
     */
    static readonly algorithms: SupportedCryptoAlgorithms[];
  }

  /**
   * Resolve a `Promise` after milliseconds. This is like
   * {@link setTimeout} except it returns a `Promise`.
   *
   * @category Utilities
   *
   * @param ms milliseconds to delay resolving the promise. This is a minimum
   * number. It may take longer. If a {@link Date} is passed, it will sleep until the
   * {@link Date} is reached.
   *
   * @example
   * ## Sleep for 1 second
   * ```ts
   * import { sleep } from "bun";
   *
   * await sleep(1000);
   * ```
   * ## Sleep for 10 milliseconds
   * ```ts
   * await Bun.sleep(10);
   * ```
   * ## Sleep until `Date`
   *
   * ```ts
   * const target = new Date();
   * target.setSeconds(target.getSeconds() + 1);
   * await Bun.sleep(target);
   * ```
   * Internally, `Bun.sleep` is the equivalent of
   * ```ts
   * await new Promise((resolve) => setTimeout(resolve, ms));
   * ```
   * As always, you can use `Bun.sleep` or the imported `sleep` function interchangeably.
   */
  function sleep(ms: number | Date): Promise<void>;

  /**
   * Sleep the thread for a given number of milliseconds
   *
   * This is a blocking function.
   *
   * Internally, it calls [nanosleep(2)](https://man7.org/linux/man-pages/man2/nanosleep.2.html)
   */
  function sleepSync(ms: number): void;

  /**
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
   *
   * @category Utilities
   *
   * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` will be faster
   * @param hashInto optional `Uint8Array` to write the hash to. 32 bytes minimum.
   *
   * This hashing function balances speed with cryptographic strength. This does not encrypt or decrypt data.
   *
   * The implementation uses [BoringSSL](https://boringssl.googlesource.com/boringssl) (used in Chromium & Go)
   *
   * The equivalent `openssl` command is:
   *
   * ```bash
   * # You will need OpenSSL 3 or later
   * openssl sha512-256 /path/to/file
   * ```
   */
  function sha(input: Bun.StringOrBuffer, hashInto?: NodeJS.TypedArray): NodeJS.TypedArray;

  /**
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
   *
   * @category Utilities
   *
   * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` will be faster
   * @param encoding `DigestEncoding` to return the hash in
   *
   * This hashing function balances speed with cryptographic strength. This does not encrypt or decrypt data.
   *
   * The implementation uses [BoringSSL](https://boringssl.googlesource.com/boringssl) (used in Chromium & Go)
   *
   * The equivalent `openssl` command is:
   *
   * ```bash
   * # You will need OpenSSL 3 or later
   * openssl sha512-256 /path/to/file
   * ```
   */
  function sha(input: Bun.StringOrBuffer, encoding: DigestEncoding): string;

  /**
   * This is not the default because it's not cryptographically secure and it's slower than {@link SHA512}
   *
   * Consider using the ugly-named {@link SHA512_256} instead
   */
  class SHA1 extends CryptoHashInterface<SHA1> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 20;
  }
  class MD5 extends CryptoHashInterface<MD5> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 16;
  }
  class MD4 extends CryptoHashInterface<MD4> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 16;
  }
  class SHA224 extends CryptoHashInterface<SHA224> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 28;
  }
  class SHA512 extends CryptoHashInterface<SHA512> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 64;
  }
  class SHA384 extends CryptoHashInterface<SHA384> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 48;
  }
  class SHA256 extends CryptoHashInterface<SHA256> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 32;
  }
  /**
   * See also {@link sha}
   */
  class SHA512_256 extends CryptoHashInterface<SHA512_256> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 32;
  }

  /** Compression options for `Bun.deflateSync` and `Bun.gzipSync` */
  interface ZlibCompressionOptions {
    /**
     * The compression level to use. Must be between `-1` and `9`.
     * - A value of `-1` uses the default compression level (Currently `6`)
     * - A value of `0` gives no compression
     * - A value of `1` gives least compression, fastest speed
     * - A value of `9` gives best compression, slowest speed
     */
    level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    /**
     * How much memory should be allocated for the internal compression state.
     *
     * A value of `1` uses minimum memory but is slow and reduces compression ratio.
     *
     * A value of `9` uses maximum memory for optimal speed. The default is `8`.
     */
    memLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    /**
     * The base 2 logarithm of the window size (the size of the history buffer).
     *
     * Larger values of this parameter result in better compression at the expense of memory usage.
     *
     * The following value ranges are supported:
     * - `9..15`: The output will have a zlib header and footer (Deflate)
     * - `-9..-15`: The output will **not** have a zlib header or footer (Raw Deflate)
     * - `25..31` (16+`9..15`): The output will have a gzip header and footer (gzip)
     *
     * The gzip header will have no file name, no extra data, no comment, no modification time (set to zero) and no header CRC.
     */
    windowBits?:
      | -9
      | -10
      | -11
      | -12
      | -13
      | -14
      | -15
      | 9
      | 10
      | 11
      | 12
      | 13
      | 14
      | 15
      | 25
      | 26
      | 27
      | 28
      | 29
      | 30
      | 31;
    /**
     * Tunes the compression algorithm.
     *
     * - `Z_DEFAULT_STRATEGY`: For normal data **(Default)**
     * - `Z_FILTERED`: For data produced by a filter or predictor
     * - `Z_HUFFMAN_ONLY`: Force Huffman encoding only (no string match)
     * - `Z_RLE`: Limit match distances to one (run-length encoding)
     * - `Z_FIXED` prevents the use of dynamic Huffman codes
     *
     * `Z_RLE` is designed to be almost as fast as `Z_HUFFMAN_ONLY`, but give better compression for PNG image data.
     *
     * `Z_FILTERED` forces more Huffman coding and less string matching, it is
     * somewhat intermediate between `Z_DEFAULT_STRATEGY` and `Z_HUFFMAN_ONLY`.
     * Filtered data consists mostly of small values with a somewhat random distribution.
     */
    strategy?: number;

    library?: "zlib";
  }

  interface LibdeflateCompressionOptions {
    level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    library?: "libdeflate";
  }

  /**
   * Compresses a chunk of data with `zlib` DEFLATE algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  function deflateSync(
    data: Uint8Array | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array;
  /**
   * Compresses a chunk of data with `zlib` GZIP algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  function gzipSync(
    data: Uint8Array | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array;
  /**
   * Decompresses a chunk of data with `zlib` INFLATE algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  function inflateSync(
    data: Uint8Array | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array;
  /**
   * Decompresses a chunk of data with `zlib` GUNZIP algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  function gunzipSync(
    data: Uint8Array | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array;

  /**
   * Compresses a chunk of data with the Zstandard (zstd) compression algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  function zstdCompressSync(
    data: NodeJS.TypedArray | Buffer | string | ArrayBuffer,
    options?: { level?: number },
  ): Buffer;

  /**
   * Compresses a chunk of data with the Zstandard (zstd) compression algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns A promise that resolves to the output buffer with the compressed data
   */
  function zstdCompress(
    data: NodeJS.TypedArray | Buffer | string | ArrayBuffer,
    options?: { level?: number },
  ): Promise<Buffer>;

  /**
   * Decompresses a chunk of data with the Zstandard (zstd) decompression algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  function zstdDecompressSync(data: NodeJS.TypedArray | Buffer | string | ArrayBuffer): Buffer;

  /**
   * Decompresses a chunk of data with the Zstandard (zstd) decompression algorithm.
   * @param data The buffer of data to decompress
   * @returns A promise that resolves to the output buffer with the decompressed data
   */
  function zstdDecompress(data: NodeJS.TypedArray | Buffer | string | ArrayBuffer): Promise<Buffer>;

  type Target =
    /**
     * For generating bundles that are intended to be run by the Bun runtime. In many cases,
     * it isn't necessary to bundle server-side code; you can directly execute the source code
     * without modification. However, bundling your server code can reduce startup times and
     * improve running performance.
     *
     * All bundles generated with `target: "bun"` are marked with a special `// @bun` pragma, which
     * indicates to the Bun runtime that there's no need to re-transpile the file before execution.
     */
    | "bun"
    /**
     * The plugin will be applied to Node.js builds
     */
    | "node"
    /**
     * The plugin will be applied to browser builds
     */
    | "browser";

  /** https://bun.sh/docs/bundler/loaders */
  type Loader = "js" | "jsx" | "ts" | "tsx" | "json" | "toml" | "file" | "napi" | "wasm" | "text" | "css" | "html";

  interface PluginConstraints {
    /**
     * Only apply the plugin when the import specifier matches this regular expression
     *
     * @example
     * ```ts
     * // Only apply the plugin when the import specifier matches the regex
     * Bun.plugin({
     *  setup(builder) {
     *     builder.onLoad({ filter: /node_modules\/underscore/ }, (args) => {
     *      return { contents: "throw new Error('Please use lodash instead of underscore.')" };
     *     });
     *  }
     * })
     * ```
     */
    filter: RegExp;

    /**
     * Only apply the plugin when the import specifier has a namespace matching
     * this string
     *
     * Namespaces are prefixes in import specifiers. For example, `"bun:ffi"`
     * has the namespace `"bun"`.
     *
     * The default namespace is `"file"` and it can be omitted from import
     * specifiers.
     */
    namespace?: string;
  }

  interface OnLoadResultSourceCode {
    /**
     * The source code of the module
     */
    contents: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer;
    /**
     * The loader to use for this file
     *
     * "css" will be added in a future version of Bun.
     */
    loader?: Loader;
  }

  interface OnLoadResultObject {
    /**
     * The object to use as the module
     * @example
     * ```ts
     * // In your loader
     * builder.onLoad({ filter: /^hello:world$/ }, (args) => {
     *    return { exports: { foo: "bar" }, loader: "object" };
     * });
     *
     * // In your script
     * import {foo} from "hello:world";
     * console.log(foo); // "bar"
     * ```
     */
    exports: Record<string, unknown>;
    /**
     * The loader to use for this file
     */
    loader: "object";
  }

  interface OnLoadArgs {
    /**
     * The resolved import specifier of the module being loaded
     * @example
     * ```ts
     * builder.onLoad({ filter: /^hello:world$/ }, (args) => {
     *   console.log(args.path); // "hello:world"
     *   return { exports: { foo: "bar" }, loader: "object" };
     * });
     * ```
     */
    path: string;
    /**
     * The namespace of the module being loaded
     */
    namespace: string;
    /**
     * The default loader for this file extension
     */
    loader: Loader;
    /**
     * Defer the execution of this callback until all other modules have been parsed.
     *
     * @returns Promise which will be resolved when all modules have been parsed
     */
    defer: () => Promise<void>;
  }

  type OnLoadResult = OnLoadResultSourceCode | OnLoadResultObject | undefined | void;
  type OnLoadCallback = (args: OnLoadArgs) => OnLoadResult | Promise<OnLoadResult>;
  type OnStartCallback = () => void | Promise<void>;

  interface OnResolveArgs {
    /**
     * The import specifier of the module being loaded
     */
    path: string;
    /**
     * The module that imported the module being resolved
     */
    importer: string;
    /**
     * The namespace of the importer.
     */
    namespace: string;
    /**
     * The directory to perform file-based resolutions in.
     */
    resolveDir: string;
    /**
     * The kind of import this resolve is for.
     */
    kind: ImportKind;
    // resolveDir: string;
    // pluginData: any;
  }

  interface OnResolveResult {
    /**
     * The destination of the import
     */
    path: string;
    /**
     * The namespace of the destination
     * It will be concatenated with `path` to form the final import specifier
     * @example
     * ```ts
     * "foo" // "foo:bar"
     * ```
     */
    namespace?: string;
    external?: boolean;
  }

  type OnResolveCallback = (
    args: OnResolveArgs,
  ) => OnResolveResult | Promise<OnResolveResult | undefined | null> | undefined | null;

  type FFIFunctionCallable = Function & {
    // Making a nominally typed function so that the user must get it from dlopen
    readonly __ffi_function_callable: typeof import("bun:ffi").FFIFunctionCallableSymbol;
  };

  /**
   * The builder object passed to `Bun.plugin`
   *
   * @category Bundler
   */
  interface PluginBuilder {
    /**
     * Register a callback which will be invoked when bundling starts. When
     * using hot module reloading, this is called at the start of each
     * incremental rebuild.
     *
     * @example
     * ```ts
     * Bun.plugin({
     *   setup(builder) {
     *     builder.onStart(() => {
     *       console.log("bundle just started!!")
     *     });
     *   },
     * });
     * ```
     *
     * @returns `this` for method chaining
     */
    onStart(callback: OnStartCallback): this;
    onBeforeParse(
      constraints: PluginConstraints,
      callback: {
        napiModule: unknown;
        symbol: string;
        external?: unknown | undefined;
      },
    ): this;
    /**
     * Register a callback to load imports with a specific import specifier
     * @param constraints The constraints to apply the plugin to
     * @param callback The callback to handle the import
     * @example
     * ```ts
     * Bun.plugin({
     *   setup(builder) {
     *     builder.onLoad({ filter: /^hello:world$/ }, (args) => {
     *       return { exports: { foo: "bar" }, loader: "object" };
     *     });
     *   },
     * });
     * ```
     *
     * @returns `this` for method chaining
     */
    onLoad(constraints: PluginConstraints, callback: OnLoadCallback): this;
    /**
     * Register a callback to resolve imports matching a filter and/or namespace
     * @param constraints The constraints to apply the plugin to
     * @param callback The callback to handle the import
     * @example
     * ```ts
     * Bun.plugin({
     *   setup(builder) {
     *     builder.onResolve({ filter: /^wat$/ }, (args) => {
     *       return { path: "/tmp/woah.js" };
     *     });
     *   },
     * });
     * ```
     *
     * @returns `this` for method chaining
     */
    onResolve(constraints: PluginConstraints, callback: OnResolveCallback): this;
    /**
     * The config object passed to `Bun.build` as is. Can be mutated.
     */
    config: BuildConfig & { plugins: BunPlugin[] };

    /**
     * Create a lazy-loaded virtual module that can be `import`ed or `require`d from other modules
     *
     * @param specifier The module specifier to register the callback for
     * @param callback The function to run when the module is imported or required
     *
     * @example
     * ```ts
     * Bun.plugin({
     *   setup(builder) {
     *     builder.module("hello:world", () => {
     *       return { exports: { foo: "bar" }, loader: "object" };
     *     });
     *   },
     * });
     *
     * // sometime later
     * const { foo } = await import("hello:world");
     * console.log(foo); // "bar"
     *
     * // or
     * const { foo } = require("hello:world");
     * console.log(foo); // "bar"
     * ```
     *
     * @returns `this` for method chaining
     */
    module(specifier: string, callback: () => OnLoadResult | Promise<OnLoadResult>): this;
  }

  /**
   * A Bun plugin. Used for extending Bun's behavior at runtime, or with {@link Bun.build}
   *
   * @category Bundler
   */
  interface BunPlugin {
    /**
     * Human-readable name of the plugin
     *
     * In a future version of Bun, this will be used in error messages.
     */
    name: string;

    /**
     * The target JavaScript environment the plugin should be applied to.
     * - `bun`: The default environment when using `bun run` or `bun` to load a script
     * - `browser`: The plugin will be applied to browser builds
     * - `node`: The plugin will be applied to Node.js builds
     *
     * If unspecified, it is assumed that the plugin is compatible with all targets.
     *
     * This field is not read by {@link Bun.plugin}, only {@link Bun.build} and `bun build`
     */
    target?: Target;

    /**
     * A function that will be called when the plugin is loaded.
     *
     * This function may be called in the same tick that it is registered, or it
     * may be called later. It could potentially be called multiple times for
     * different targets.
     */
    setup(
      /**
       * A builder object that can be used to register plugin hooks
       * @example
       * ```ts
       * builder.onLoad({ filter: /\.yaml$/ }, ({ path }) => ({
       *   loader: "object",
       *   exports: require("js-yaml").load(fs.readFileSync(path, "utf8")),
       * }));
       * ```
       */
      build: PluginBuilder,
    ): void | Promise<void>;
  }

  /**
   * Extend Bun's module resolution and loading behavior
   *
   * Plugins are applied in the order they are defined.
   *
   * Today, there are two kinds of hooks:
   * - `onLoad` lets you return source code or an object that will become the module's exports
   * - `onResolve` lets you redirect a module specifier to another module specifier. It does not chain.
   *
   * Plugin hooks must define a `filter` RegExp and will only be matched if the
   * import specifier contains a "." or a ":".
   *
   * ES Module resolution semantics mean that plugins may be initialized _after_
   * a module is resolved. You might need to load plugins at the very beginning
   * of the application and then use a dynamic import to load the rest of the
   * application. A future version of Bun may also support specifying plugins
   * via `bunfig.toml`.
   *
   * @example
   * A YAML loader plugin
   *
   * ```js
   * Bun.plugin({
   *  setup(builder) {
   *   builder.onLoad({ filter: /\.yaml$/ }, ({path}) => ({
   *     loader: "object",
   *     exports: require("js-yaml").load(fs.readFileSync(path, "utf8"))
   *   }));
   * });
   *
   * // You can use require()
   * const {foo} = require("./file.yaml");
   *
   * // Or import
   * await import("./file.yaml");
   *
   * ```
   */
  interface BunRegisterPlugin {
    <T extends BunPlugin>(options: T): ReturnType<T["setup"]>;

    /**
     * Deactivate all plugins
     *
     * This prevents registered plugins from being applied to future builds.
     */
    clearAll(): void;
  }

  const plugin: BunRegisterPlugin;

  /**
   * Is the current global scope the main thread?
   */
  const isMainThread: boolean;

  /**
   * Used when importing an HTML file at runtime or at build time.
   *
   * @example
   *
   * ```ts
   * import app from "./index.html";
   * ```
   *
   */

  interface HTMLBundle {
    index: string;

    /** Array of generated output files with metadata. This only exists when built ahead of time with `Bun.build` or `bun build` */
    files?: Array<{
      /** Original source file path. */
      input?: string;
      /** Generated output file path (with content hash, if included in naming) */
      path: string;
      /** File type/loader used (js, css, html, file, etc.) */
      loader: Loader;
      /** Whether this file is an entry point */
      isEntry: boolean;
      /** HTTP headers including ETag and Content-Type */
      headers: {
        /** ETag for caching */
        etag: string;
        /** MIME type with charset */
        "content-type": string;

        /**
         * Additional headers may be added in the future.
         */
        [key: string]: string;
      };
    }>;
  }

  /**
   * Represents a TCP or TLS socket connection used for network communication.
   * This interface provides methods for reading, writing, managing the connection state,
   * and handling TLS-specific features if applicable.
   *
   * Sockets are created using `Bun.connect()` or accepted by a `Bun.listen()` server.
   *
   * @category HTTP & Networking
   */
  interface Socket<Data = undefined> extends Disposable {
    /**
     * Writes `data` to the socket. This method is unbuffered and non-blocking. This uses the `sendto(2)` syscall internally.
     *
     * For optimal performance with multiple small writes, consider batching multiple
     * writes together into a single `socket.write()` call.
     *
     * @param data The data to write. Can be a string (encoded as UTF-8), `ArrayBuffer`, `TypedArray`, or `DataView`.
     * @param byteOffset The offset in bytes within the buffer to start writing from. Defaults to 0. Ignored for strings.
     * @param byteLength The number of bytes to write from the buffer. Defaults to the remaining length of the buffer from the offset. Ignored for strings.
     * @returns The number of bytes written. Returns `-1` if the socket is closed or shutting down. Can return less than the input size if the socket's buffer is full (backpressure).
     * @example
     * ```ts
     * // Send a string
     * const bytesWritten = socket.write("Hello, world!\n");
     *
     * // Send binary data
     * const buffer = new Uint8Array([0x01, 0x02, 0x03]);
     * socket.write(buffer);
     *
     * // Send part of a buffer
     * const largeBuffer = new Uint8Array(1024);
     * // ... fill largeBuffer ...
     * socket.write(largeBuffer, 100, 50); // Write 50 bytes starting from index 100
     * ```
     */
    write(data: string | BufferSource, byteOffset?: number, byteLength?: number): number;

    /**
     * The user-defined data associated with this socket instance.
     * This can be set when the socket is created via `Bun.connect({ data: ... })`.
     * It can be read or updated at any time.
     *
     * @example
     * ```ts
     * // In a socket handler
     * function open(socket: Socket<{ userId: string }>) {
     *   console.log(`Socket opened for user: ${socket.data.userId}`);
     *   socket.data.lastActivity = Date.now(); // Update data
     * }
     * ```
     */
    data: Data;

    /**
     * Sends the final data chunk and initiates a graceful shutdown of the socket's write side.
     * After calling `end()`, no more data can be written using `write()` or `end()`.
     * The socket remains readable until the remote end also closes its write side or the connection is terminated.
     * This sends a TCP FIN packet after writing the data.
     *
     * @param data Optional final data to write before closing. Same types as `write()`.
     * @param byteOffset Optional offset for buffer data.
     * @param byteLength Optional length for buffer data.
     * @returns The number of bytes written for the final chunk. Returns `-1` if the socket was already closed or shutting down.
     * @example
     * ```ts
     * // send some data and close the write side
     * socket.end("Goodbye!");
     * // or close write side without sending final data
     * socket.end();
     * ```
     */
    end(data?: string | BufferSource, byteOffset?: number, byteLength?: number): number;

    /**
     * Close the socket immediately
     */
    end(): void;

    /**
     * Keep Bun's process alive at least until this socket is closed
     *
     * After the socket has closed, the socket is unref'd, the process may exit,
     * and this becomes a no-op
     */
    ref(): void;

    /**
     * Set a timeout until the socket automatically closes.
     *
     * To reset the timeout, call this function again.
     *
     * When a timeout happens, the `timeout` callback is called and the socket is closed.
     */
    timeout(seconds: number): void;

    /**
     * Forcefully closes the socket connection immediately. This is an abrupt termination, unlike the graceful shutdown initiated by `end()`.
     * It uses `SO_LINGER` with `l_onoff=1` and `l_linger=0` before calling `close(2)`.
     * Consider using {@link close close()} or {@link end end()} for graceful shutdowns.
     *
     * @example
     * ```ts
     * socket.terminate();
     * ```
     */
    terminate(): void;

    /**
     * Shuts down the write-half or both halves of the connection.
     * This allows the socket to enter a half-closed state where it can still receive data
     * but can no longer send data (`halfClose = true`), or close both read and write
     * (`halfClose = false`, similar to `end()` but potentially more immediate depending on OS).
     * Calls `shutdown(2)` syscall internally.
     *
     * @param halfClose If `true`, only shuts down the write side (allows receiving). If `false` or omitted, shuts down both read and write. Defaults to `false`.
     * @example
     * ```ts
     * // Stop sending data, but allow receiving
     * socket.shutdown(true);
     *
     * // Shutdown both reading and writing
     * socket.shutdown();
     * ```
     */
    shutdown(halfClose?: boolean): void;

    /**
     * The ready state of the socket.
     *
     * You can assume that a positive value means the socket is open and usable
     *
     * - `-2` = Shutdown
     * - `-1` = Detached
     * - `0` = Closed
     * - `1` = Established
     * - `2` = Else
     */
    readonly readyState: -2 | -1 | 0 | 1 | 2;

    /**
     * Allow Bun's process to exit even if this socket is still open
     *
     * After the socket has closed, this function does nothing.
     */
    unref(): void;

    /**
     * Flush any buffered data to the socket
     * This attempts to send the data immediately, but success depends on the network conditions
     * and the receiving end.
     * It might be necessary after several `write` calls if immediate sending is critical,
     * though often the OS handles flushing efficiently. Note that `write` calls outside
     * `open`/`data`/`drain` might benefit from manual `cork`/`flush`.
     */
    flush(): void;

    /**
     * Reset the socket's callbacks. This is useful with `bun --hot` to facilitate hot reloading.
     *
     * This will apply to all sockets from the same {@link Listener}. it is per socket only for {@link Bun.connect}.
     */
    reload(handler: SocketHandler): void;

    /**
     * Get the server that created this socket
     *
     * This will return undefined if the socket was created by {@link Bun.connect} or if the listener has already closed.
     */
    readonly listener?: SocketListener;

    readonly remoteFamily: "IPv4" | "IPv6";

    /**
     * Remote IP address connected to the socket
     * @example "192.168.1.100" | "2001:db8::1"
     */
    readonly remoteAddress: string;

    /**
     * Remote port connected to the socket
     * @example 8080
     */
    readonly remotePort: number;

    /**
     * IP protocol family used for the local endpoint of the socket
     * @example "IPv4" | "IPv6"
     */
    readonly localFamily: "IPv4" | "IPv6";

    /**
     * Local IP address connected to the socket
     * @example "192.168.1.100" | "2001:db8::1"
     */
    readonly localAddress: string;

    /**
     * local port connected to the socket
     * @example 8080
     */
    readonly localPort: number;

    /**
     * This property is `true` if the peer certificate was signed by one of the CAs
     * specified when creating the `Socket` instance, otherwise `false`.
     */
    readonly authorized: boolean;

    /**
     * String containing the selected ALPN protocol.
     * Before a handshake has completed, this value is always null.
     * When a handshake is completed but not ALPN protocol was selected, socket.alpnProtocol equals false.
     */
    readonly alpnProtocol: string | false | null;

    /**
     * Disables TLS renegotiation for this `Socket` instance. Once called, attempts
     * to renegotiate will trigger an `error` handler on the `Socket`.
     *
     * There is no support for renegotiation as a server. (Attempts by clients will result in a fatal alert so that ClientHello messages cannot be used to flood a server and escape higher-level limits.)
     */
    disableRenegotiation(): void;

    /**
     * Keying material is used for validations to prevent different kind of attacks in
     * network protocols, for example in the specifications of IEEE 802.1X.
     *
     * Example
     *
     * ```js
     * const keyingMaterial = socket.exportKeyingMaterial(
     *   128,
     *   'client finished');
     *
     * /*
     *  Example return value of keyingMaterial:
     *  <Buffer 76 26 af 99 c5 56 8e 42 09 91 ef 9f 93 cb ad 6c 7b 65 f8 53 f1 d8 d9
     *     12 5a 33 b8 b5 25 df 7b 37 9f e0 e2 4f b8 67 83 a3 2f cd 5d 41 42 4c 91
     *     74 ef 2c ... 78 more bytes>
     *
     * ```
     *
     * @param length number of bytes to retrieve from keying material
     * @param label an application specific label, typically this will be a value from the [IANA Exporter Label
     * Registry](https://www.iana.org/assignments/tls-parameters/tls-parameters.xhtml#exporter-labels).
     * @param context Optionally provide a context.
     * @return requested bytes of the keying material
     */
    exportKeyingMaterial(length: number, label: string, context: Buffer): Buffer;

    /**
     * Returns the reason why the peer's certificate was not been verified. This
     * property is set only when `socket.authorized === false`.
     */
    getAuthorizationError(): Error | null;

    /**
     * Returns an object representing the local certificate. The returned object has
     * some properties corresponding to the fields of the certificate.
     *
     * If there is no local certificate, an empty object will be returned. If the
     * socket has been destroyed, `null` will be returned.
     */
    getCertificate(): import("tls").PeerCertificate | object | null;
    getX509Certificate(): import("node:crypto").X509Certificate | undefined;

    /**
     * Returns an object containing information on the negotiated cipher suite.
     *
     * For example, a TLSv1.2 protocol with AES256-SHA cipher:
     *
     * ```json
     * {
     *     "name": "AES256-SHA",
     *     "standardName": "TLS_RSA_WITH_AES_256_CBC_SHA",
     *     "version": "SSLv3"
     * }
     * ```
     *
     */
    getCipher(): import("tls").CipherNameAndProtocol;

    /**
     * Returns an object representing the type, name, and size of parameter of
     * an ephemeral key exchange in `perfect forward secrecy` on a client
     * connection. It returns an empty object when the key exchange is not
     * ephemeral. As this is only supported on a client socket; `null` is returned
     * if called on a server socket. The supported types are `'DH'` and `'ECDH'`. The`name` property is available only when type is `'ECDH'`.
     *
     * For example: `{ type: 'ECDH', name: 'prime256v1', size: 256 }`.
     */
    getEphemeralKeyInfo(): import("tls").EphemeralKeyInfo | object | null;

    /**
     * Returns an object representing the peer's certificate. If the peer does not
     * provide a certificate, an empty object will be returned. If the socket has been
     * destroyed, `null` will be returned.
     *
     * If the full certificate chain was requested, each certificate will include an`issuerCertificate` property containing an object representing its issuer's
     * certificate.
     * @return A certificate object.
     */
    getPeerCertificate(): import("node:tls").PeerCertificate;
    getPeerX509Certificate(): import("node:crypto").X509Certificate;

    /**
     * See [SSL\_get\_shared\_sigalgs](https://www.openssl.org/docs/man1.1.1/man3/SSL_get_shared_sigalgs.html) for more information.
     * @since v12.11.0
     * @return List of signature algorithms shared between the server and the client in the order of decreasing preference.
     */
    getSharedSigalgs(): string[];

    /**
     * As the `Finished` messages are message digests of the complete handshake
     * (with a total of 192 bits for TLS 1.0 and more for SSL 3.0), they can
     * be used for external authentication procedures when the authentication
     * provided by SSL/TLS is not desired or is not enough.
     *
     * @return The latest `Finished` message that has been sent to the socket as part of a SSL/TLS handshake, or `undefined` if no `Finished` message has been sent yet.
     */
    getTLSFinishedMessage(): Buffer | undefined;

    /**
     * As the `Finished` messages are message digests of the complete handshake
     * (with a total of 192 bits for TLS 1.0 and more for SSL 3.0), they can
     * be used for external authentication procedures when the authentication
     * provided by SSL/TLS is not desired or is not enough.
     *
     * @return The latest `Finished` message that is expected or has actually been received from the socket as part of a SSL/TLS handshake, or `undefined` if there is no `Finished` message so
     * far.
     */
    getTLSPeerFinishedMessage(): Buffer | undefined;

    /**
     * For a client, returns the TLS session ticket if one is available, or`undefined`. For a server, always returns `undefined`.
     *
     * It may be useful for debugging.
     *
     * See `Session Resumption` for more information.
     */
    getTLSTicket(): Buffer | undefined;

    /**
     * Returns a string containing the negotiated SSL/TLS protocol version of the
     * current connection. The value `'unknown'` will be returned for connected
     * sockets that have not completed the handshaking process. The value `null` will
     * be returned for server sockets or disconnected client sockets.
     *
     * Protocol versions are:
     *
     * * `'SSLv3'`
     * * `'TLSv1'`
     * * `'TLSv1.1'`
     * * `'TLSv1.2'`
     * * `'TLSv1.3'`
     *
     */
    getTLSVersion(): string;

    /**
     * See `Session Resumption` for more information.
     * @return `true` if the session was reused, `false` otherwise.
     * **TLS Only:** Checks if the current TLS session was resumed from a previous session.
     * Returns `true` if the session was resumed, `false` otherwise.
     */
    isSessionReused(): boolean;

    /**
     * The `socket.setMaxSendFragment()` method sets the maximum TLS fragment size.
     * Returns `true` if setting the limit succeeded; `false` otherwise.
     *
     * Smaller fragment sizes decrease the buffering latency on the client: larger
     * fragments are buffered by the TLS layer until the entire fragment is received
     * and its integrity is verified; large fragments can span multiple roundtrips
     * and their processing can be delayed due to packet loss or reordering. However,
     * smaller fragments add extra TLS framing bytes and CPU overhead, which may
     * decrease overall server throughput.
     * @param [size=16384] The maximum TLS fragment size. The maximum value is `16384`.
     */
    setMaxSendFragment(size: number): boolean;

    /**
     * Enable/disable the use of Nagle's algorithm.
     * Only available for already connected sockets, will return false otherwise
     * @param noDelay Default: `true`
     * @returns true if is able to setNoDelay and false if it fails.
     */
    setNoDelay(noDelay?: boolean): boolean;

    /**
     * Enable/disable keep-alive functionality, and optionally set the initial delay before the first keepalive probe is sent on an idle socket.
     * Set `initialDelay` (in milliseconds) to set the delay between the last data packet received and the first keepalive probe.
     * Only available for already connected sockets, will return false otherwise.
     *
     * Enabling the keep-alive functionality will set the following socket options:
     * SO_KEEPALIVE=1
     * TCP_KEEPIDLE=initialDelay
     * TCP_KEEPCNT=10
     * TCP_KEEPINTVL=1
     * @param enable Default: `false`
     * @param initialDelay Default: `0`
     * @returns true if is able to setNoDelay and false if it fails.
     */
    setKeepAlive(enable?: boolean, initialDelay?: number): boolean;

    /**
     * The total number of bytes successfully written to the socket since it was established.
     * This includes data currently buffered by the OS but not yet acknowledged by the remote peer.
     */
    readonly bytesWritten: number;

    /**
     * Alias for `socket.end()`. Allows the socket to be used with `using` declarations
     * for automatic resource management.
     * @example
     * ```ts
     * async function processSocket() {
     *   using socket = await Bun.connect({ ... });
     *   socket.write("Data");
     *   // socket.end() is called automatically when exiting the scope
     * }
     * ```
     */
    [Symbol.dispose](): void;

    resume(): void;

    pause(): void;

    /**
     * If this is a TLS Socket
     */
    renegotiate(): void;

    /**
     * Sets the verify mode of the socket.
     *
     * @param requestCert Whether to request a certificate.
     * @param rejectUnauthorized Whether to reject unauthorized certificates.
     */
    setVerifyMode(requestCert: boolean, rejectUnauthorized: boolean): void;

    getSession(): void;

    /**
     * Sets the session of the socket.
     *
     * @param session The session to set.
     */
    setSession(session: string | Buffer | BufferSource): void;

    /**
     * Exports the keying material of the socket.
     *
     * @param length The length of the keying material to export.
     * @param label The label of the keying material to export.
     * @param context The context of the keying material to export.
     */
    exportKeyingMaterial(length: number, label: string, context?: string | BufferSource): void;

    /**
     * Upgrades the socket to a TLS socket.
     *
     * @param options The options for the upgrade.
     * @returns A tuple containing the raw socket and the TLS socket.
     * @see {@link TLSUpgradeOptions}
     */
    upgradeTLS<Data>(options: TLSUpgradeOptions<Data>): [raw: Socket<Data>, tls: Socket<Data>];

    /**
     * Closes the socket.
     *
     * This is a wrapper around `end()` and `shutdown()`.
     *
     * @see {@link end}
     * @see {@link shutdown}
     */
    close(): void;

    /**
     * Returns the servername of the socket.
     *
     * @see {@link setServername}
     */
    getServername(): string;

    /**
     * Sets the servername of the socket.
     *
     * @see {@link getServername}
     */
    setServername(name: string): void;
  }

  interface TLSUpgradeOptions<Data> {
    data?: Data;
    tls: TLSOptions | boolean;
    socket: SocketHandler<Data>;
  }

  interface SocketListener<Data = undefined> extends Disposable {
    stop(closeActiveConnections?: boolean): void;
    ref(): void;
    unref(): void;
    reload(options: Pick<Partial<SocketOptions>, "socket">): void;
    data: Data;
  }
  interface TCPSocketListener<Data = unknown> extends SocketListener<Data> {
    readonly port: number;
    readonly hostname: string;
  }
  interface UnixSocketListener<Data> extends SocketListener<Data> {
    readonly unix: string;
  }

  interface TCPSocket extends Socket {}
  interface TLSSocket extends Socket {}

  interface BinaryTypeList {
    arraybuffer: ArrayBuffer;
    buffer: Buffer;
    uint8array: Uint8Array;
    // TODO: DataView
    // dataview: DataView;
  }
  type BinaryType = keyof BinaryTypeList;

  interface SocketHandler<Data = unknown, DataBinaryType extends BinaryType = "buffer"> {
    /**
     * Is called when the socket connects, or in case of TLS if no handshake is provided
     * this will be called only after handshake
     * @param socket
     */
    open?(socket: Socket<Data>): void | Promise<void>;
    close?(socket: Socket<Data>, error?: Error): void | Promise<void>;
    error?(socket: Socket<Data>, error: Error): void | Promise<void>;
    data?(socket: Socket<Data>, data: BinaryTypeList[DataBinaryType]): void | Promise<void>;
    drain?(socket: Socket<Data>): void | Promise<void>;

    /**
     * When handshake is completed, this functions is called.
     * @param socket
     * @param success Indicates if the server authorized despite the authorizationError.
     * @param authorizationError Certificate Authorization Error or null.
     */
    handshake?(socket: Socket<Data>, success: boolean, authorizationError: Error | null): void;

    /**
     * When the socket has been shutdown from the other end, this function is
     * called. This is a TCP FIN packet.
     */
    end?(socket: Socket<Data>): void | Promise<void>;

    /**
     * When the socket fails to be created, this function is called.
     *
     * The promise returned by `Bun.connect` rejects **after** this function is
     * called.
     *
     * When `connectError` is specified, the rejected promise will not be
     * added to the promise rejection queue (so it won't be reported as an
     * unhandled promise rejection, since connectError handles it).
     *
     * When `connectError` is not specified, the rejected promise will be added
     * to the promise rejection queue.
     */
    connectError?(socket: Socket<Data>, error: Error): void | Promise<void>;

    /**
     * Called when a message times out.
     */
    timeout?(socket: Socket<Data>): void | Promise<void>;
    /**
     * Choose what `ArrayBufferView` is returned in the {@link SocketHandler.data} callback.
     *
     * @default "buffer"
     *
     * @remarks
     * This lets you select the desired binary type for the `data` callback.
     * It's a small performance optimization to let you avoid creating extra
     * ArrayBufferView objects when possible.
     *
     * Bun originally defaulted to `Uint8Array` but when dealing with network
     * data, it's more useful to be able to directly read from the bytes which
     * `Buffer` allows.
     */
    binaryType?: BinaryType;
  }

  interface SocketOptions<Data = unknown> {
    /**
     * Handlers for socket events
     */
    socket: SocketHandler<Data>;
    /**
     * The per-instance data context
     */
    data?: Data;
    /**
     * Whether to allow half-open connections.
     *
     * A half-open connection occurs when one end of the connection has called `close()`
     * or sent a FIN packet, while the other end remains open. When set to `true`:
     *
     * - The socket won't automatically send FIN when the remote side closes its end
     * - The local side can continue sending data even after the remote side has closed
     * - The application must explicitly call `end()` to fully close the connection
     *
     * When `false`, the socket automatically closes both ends of the connection when
     * either side closes.
     *
     * @default false
     */
    allowHalfOpen?: boolean;
  }

  interface TCPSocketListenOptions<Data = undefined> extends SocketOptions<Data> {
    /**
     * The hostname to listen on
     */
    hostname: string;
    /**
     * The port to listen on
     */
    port: number;
    /**
     * The TLS configuration object with which to create the server
     */
    tls?: TLSOptions | boolean;
    /**
     * Whether to use exclusive mode.
     *
     * When set to `true`, the socket binds exclusively to the specified address:port
     * combination, preventing other processes from binding to the same port.
     *
     * When `false` (default), other sockets may be able to bind to the same port
     * depending on the operating system's socket sharing capabilities and settings.
     *
     * Exclusive mode is useful in scenarios where you want to ensure only one
     * instance of your server can bind to a specific port at a time.
     *
     * @default false
     */
    exclusive?: boolean;
    /**
     * Whether to allow half-open connections.
     *
     * A half-open connection occurs when one end of the connection has called `close()`
     * or sent a FIN packet, while the other end remains open. When set to `true`:
     *
     * - The socket won't automatically send FIN when the remote side closes its end
     * - The local side can continue sending data even after the remote side has closed
     * - The application must explicitly call `end()` to fully close the connection
     *
     * When `false` (default), the socket automatically closes both ends of the connection
     * when either side closes.
     *
     * @default false
     */
    allowHalfOpen?: boolean;
  }

  interface TCPSocketConnectOptions<Data = undefined> extends SocketOptions<Data> {
    /**
     * The hostname to connect to
     */
    hostname: string;
    /**
     * The port to connect to
     */
    port: number;
    /**
     * TLS Configuration with which to create the socket
     */
    tls?: TLSOptions | boolean;
    /**
     * Whether to use exclusive mode.
     *
     * When set to `true`, the socket binds exclusively to the specified address:port
     * combination, preventing other processes from binding to the same port.
     *
     * When `false` (default), other sockets may be able to bind to the same port
     * depending on the operating system's socket sharing capabilities and settings.
     *
     * Exclusive mode is useful in scenarios where you want to ensure only one
     * instance of your server can bind to a specific port at a time.
     *
     * @default false
     */
    exclusive?: boolean;
    reusePort?: boolean;
    ipv6Only?: boolean;
  }

  interface UnixSocketOptions<Data = undefined> extends SocketOptions<Data> {
    /**
     * The unix socket to listen on or connect to
     */
    unix: string;
    /**
     * TLS Configuration with which to create the socket
     */
    tls?: TLSOptions | boolean;
  }

  interface FdSocketOptions<Data = undefined> extends SocketOptions<Data> {
    /**
     * TLS Configuration with which to create the socket
     */
    tls?: TLSOptions | boolean;
    /**
     * The file descriptor to connect to
     */
    fd: number;
  }

  /**
   * Create a TCP client that connects to a server via a TCP socket
   *
   * @category HTTP & Networking
   */
  function connect<Data = undefined>(options: TCPSocketConnectOptions<Data>): Promise<Socket<Data>>;
  /**
   * Create a TCP client that connects to a server via a unix socket
   *
   * @category HTTP & Networking
   */
  function connect<Data = undefined>(options: UnixSocketOptions<Data>): Promise<Socket<Data>>;

  /**
   * Create a TCP server that listens on a port
   *
   * @category HTTP & Networking
   */
  function listen<Data = undefined>(options: TCPSocketListenOptions<Data>): TCPSocketListener<Data>;
  /**
   * Create a TCP server that listens on a unix socket
   *
   * @category HTTP & Networking
   */
  function listen<Data = undefined>(options: UnixSocketOptions<Data>): UnixSocketListener<Data>;

  /**
   * @category HTTP & Networking
   */
  namespace udp {
    type Data = string | ArrayBufferView | ArrayBufferLike;

    export interface SocketHandler<DataBinaryType extends BinaryType> {
      data?(
        socket: Socket<DataBinaryType>,
        data: BinaryTypeList[DataBinaryType],
        port: number,
        address: string,
      ): void | Promise<void>;
      drain?(socket: Socket<DataBinaryType>): void | Promise<void>;
      error?(socket: Socket<DataBinaryType>, error: Error): void | Promise<void>;
    }

    export interface ConnectedSocketHandler<DataBinaryType extends BinaryType> {
      data?(
        socket: ConnectedSocket<DataBinaryType>,
        data: BinaryTypeList[DataBinaryType],
        port: number,
        address: string,
      ): void | Promise<void>;
      drain?(socket: ConnectedSocket<DataBinaryType>): void | Promise<void>;
      error?(socket: ConnectedSocket<DataBinaryType>, error: Error): void | Promise<void>;
    }

    export interface SocketOptions<DataBinaryType extends BinaryType> {
      hostname?: string;
      port?: number;
      binaryType?: DataBinaryType;
      socket?: SocketHandler<DataBinaryType>;
    }

    export interface ConnectSocketOptions<DataBinaryType extends BinaryType> {
      hostname?: string;
      port?: number;
      binaryType?: DataBinaryType;
      socket?: ConnectedSocketHandler<DataBinaryType>;
      connect: {
        hostname: string;
        port: number;
      };
    }

    export interface BaseUDPSocket {
      readonly hostname: string;
      readonly port: number;
      readonly address: SocketAddress;
      readonly binaryType: BinaryType;
      readonly closed: boolean;
      ref(): void;
      unref(): void;
      close(): void;
    }

    export interface ConnectedSocket<DataBinaryType extends BinaryType> extends BaseUDPSocket {
      readonly remoteAddress: SocketAddress;
      sendMany(packets: readonly Data[]): number;
      send(data: Data): boolean;
      reload(handler: ConnectedSocketHandler<DataBinaryType>): void;
    }

    export interface Socket<DataBinaryType extends BinaryType> extends BaseUDPSocket {
      sendMany(packets: readonly (Data | string | number)[]): number;
      send(data: Data, port: number, address: string): boolean;
      reload(handler: SocketHandler<DataBinaryType>): void;
    }
  }

  /**
   * Create a UDP socket
   *
   * @param options The options to use when creating the server
   * @param options.socket The socket handler to use
   * @param options.hostname The hostname to listen on
   * @param options.port The port to listen on
   * @param options.binaryType The binary type to use for the socket
   * @param options.connect The hostname and port to connect to
   *
   * @category HTTP & Networking
   */
  export function udpSocket<DataBinaryType extends BinaryType = "buffer">(
    options: udp.SocketOptions<DataBinaryType>,
  ): Promise<udp.Socket<DataBinaryType>>;
  export function udpSocket<DataBinaryType extends BinaryType = "buffer">(
    options: udp.ConnectSocketOptions<DataBinaryType>,
  ): Promise<udp.ConnectedSocket<DataBinaryType>>;

  namespace SpawnOptions {
    /**
     * Option for stdout/stderr
     */
    type Readable =
      | "pipe"
      | "inherit"
      | "ignore"
      | null // equivalent to "ignore"
      | undefined // to use default
      | BunFile
      | ArrayBufferView
      | number;

    /**
     * Option for stdin
     */
    type Writable =
      | "pipe"
      | "inherit"
      | "ignore"
      | null // equivalent to "ignore"
      | undefined // to use default
      | BunFile
      | ArrayBufferView
      | number
      | ReadableStream
      | Blob
      | Response
      | Request;

    interface OptionsObject<In extends Writable, Out extends Readable, Err extends Readable> {
      /**
       * The current working directory of the process
       *
       * Defaults to `process.cwd()`
       */
      cwd?: string;

      /**
       * The environment variables of the process
       *
       * Defaults to `process.env` as it was when the current Bun process launched.
       *
       * Changes to `process.env` at runtime won't automatically be reflected in the default value. For that, you can pass `process.env` explicitly.
       */
      env?: Record<string, string | undefined>;

      /**
       * The standard file descriptors of the process, in the form [stdin, stdout, stderr].
       * This overrides the `stdin`, `stdout`, and `stderr` properties.
       *
       * For stdin you may pass:
       *
       * - `"ignore"`, `null`, `undefined`: The process will have no standard input (default)
       * - `"pipe"`: The process will have a new {@link FileSink} for standard input
       * - `"inherit"`: The process will inherit the standard input of the current process
       * - `ArrayBufferView`, `Blob`, `Bun.file()`, `Response`, `Request`: The process will read from buffer/stream.
       * - `number`: The process will read from the file descriptor
       *
       * For stdout and stdin you may pass:
       *
       * - `"pipe"`, `undefined`: The process will have a {@link BunReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process will have no standard output/error
       * - `"inherit"`: The process will inherit the standard output/error of the current process
       * - `ArrayBufferView`: The process write to the preallocated buffer. Not implemented.
       * - `number`: The process will write to the file descriptor
       *
       * @default ["ignore", "pipe", "inherit"] for `spawn`
       * ["ignore", "pipe", "pipe"] for `spawnSync`
       */
      stdio?: [In, Out, Err, ...Readable[]];

      /**
       * The file descriptor for the standard input. It may be:
       *
       * - `"ignore"`, `null`, `undefined`: The process will have no standard input
       * - `"pipe"`: The process will have a new {@link FileSink} for standard input
       * - `"inherit"`: The process will inherit the standard input of the current process
       * - `ArrayBufferView`, `Blob`: The process will read from the buffer
       * - `number`: The process will read from the file descriptor
       *
       * @default "ignore"
       */
      stdin?: In;
      /**
       * The file descriptor for the standard output. It may be:
       *
       * - `"pipe"`, `undefined`: The process will have a {@link BunReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process will have no standard output/error
       * - `"inherit"`: The process will inherit the standard output/error of the current process
       * - `ArrayBufferView`: The process write to the preallocated buffer. Not implemented.
       * - `number`: The process will write to the file descriptor
       *
       * @default "pipe"
       */
      stdout?: Out;
      /**
       * The file descriptor for the standard error. It may be:
       *
       * - `"pipe"`, `undefined`: The process will have a {@link BunReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process will have no standard output/error
       * - `"inherit"`: The process will inherit the standard output/error of the current process
       * - `ArrayBufferView`: The process write to the preallocated buffer. Not implemented.
       * - `number`: The process will write to the file descriptor
       *
       * @default "inherit" for `spawn`
       * "pipe" for `spawnSync`
       */
      stderr?: Err;

      /**
       * Callback that runs when the {@link Subprocess} exits
       *
       * This is called even if the process exits with a non-zero exit code.
       *
       * Warning: this may run before the `Bun.spawn` function returns.
       *
       * A simple alternative is `await subprocess.exited`.
       *
       * @example
       *
       * ```ts
       * const subprocess = spawn({
       *  cmd: ["echo", "hello"],
       *  onExit: (subprocess, code) => {
       *    console.log(`Process exited with code ${code}`);
       *   },
       * });
       * ```
       */
      onExit?(
        subprocess: Subprocess<In, Out, Err>,
        exitCode: number | null,
        signalCode: number | null,
        /**
         * If an error occurred in the call to waitpid2, this will be the error.
         */
        error?: ErrorLike,
      ): void | Promise<void>;

      /**
       * When specified, Bun will open an IPC channel to the subprocess. The passed callback is called for
       * incoming messages, and `subprocess.send` can send messages to the subprocess. Messages are serialized
       * using the JSC serialize API, which allows for the same types that `postMessage`/`structuredClone` supports.
       *
       * The subprocess can send and receive messages by using `process.send` and `process.on("message")`,
       * respectively. This is the same API as what Node.js exposes when `child_process.fork()` is used.
       *
       * Currently, this is only compatible with processes that are other `bun` instances.
       */
      ipc?(
        message: any,
        /**
         * The {@link Subprocess} that received the message
         */
        subprocess: Subprocess<In, Out, Err>,
        handle?: unknown,
      ): void;

      /**
       * The serialization format to use for IPC messages. Defaults to `"advanced"`.
       *
       * To communicate with Node.js processes, use `"json"`.
       *
       * When `ipc` is not specified, this is ignored.
       */
      serialization?: "json" | "advanced";

      /**
       * If true, the subprocess will have a hidden window.
       */
      windowsHide?: boolean;

      /**
       * If true, no quoting or escaping of arguments is done on Windows.
       */
      windowsVerbatimArguments?: boolean;

      /**
       * Path to the executable to run in the subprocess. This defaults to `cmds[0]`.
       *
       * One use-case for this is for applications which wrap other applications or to simulate a symlink.
       *
       * @default cmds[0]
       */
      argv0?: string;

      /**
       * An {@link AbortSignal} that can be used to abort the subprocess.
       *
       * This is useful for aborting a subprocess when some other part of the
       * program is aborted, such as a `fetch` response.
       *
       * If the signal is aborted, the process will be killed with the signal
       * specified by `killSignal` (defaults to SIGTERM).
       *
       * @example
       * ```ts
       * const controller = new AbortController();
       * const { signal } = controller;
       * const start = performance.now();
       * const subprocess = Bun.spawn({
       *  cmd: ["sleep", "100"],
       *  signal,
       * });
       * await Bun.sleep(1);
       * controller.abort();
       * await subprocess.exited;
       * const end = performance.now();
       * console.log(end - start); // 1ms instead of 101ms
       * ```
       */
      signal?: AbortSignal;

      /**
       * The maximum amount of time the process is allowed to run in milliseconds.
       *
       * If the timeout is reached, the process will be killed with the signal
       * specified by `killSignal` (defaults to SIGTERM).
       *
       * @example
       * ```ts
       * // Kill the process after 5 seconds
       * const subprocess = Bun.spawn({
       *   cmd: ["sleep", "10"],
       *   timeout: 5000,
       * });
       * await subprocess.exited; // Will resolve after 5 seconds
       * ```
       */
      timeout?: number;

      /**
       * The signal to use when killing the process after a timeout, when the AbortSignal is aborted,
       * or when the process goes over the `maxBuffer` limit.
       *
       * @default "SIGTERM" (signal 15)
       *
       * @example
       * ```ts
       * // Kill the process with SIGKILL after 5 seconds
       * const subprocess = Bun.spawn({
       *   cmd: ["sleep", "10"],
       *   timeout: 5000,
       *   killSignal: "SIGKILL",
       * });
       * ```
       */
      killSignal?: string | number;

      /**
       * The maximum number of bytes the process may output. If the process goes over this limit,
       * it is killed with signal `killSignal` (defaults to SIGTERM).
       *
       * @default undefined (no limit)
       */
      maxBuffer?: number;
    }

    type ReadableIO = ReadableStream<Uint8Array> | number | undefined;

    type ReadableToIO<X extends Readable> = X extends "pipe" | undefined
      ? BunReadableStream
      : X extends BunFile | ArrayBufferView | number
        ? number
        : undefined;

    type ReadableToSyncIO<X extends Readable> = X extends "pipe" | undefined ? Buffer : undefined;

    type WritableIO = FileSink | number | undefined;

    type WritableToIO<X extends Writable> = X extends "pipe"
      ? FileSink
      : X extends BunFile | ArrayBufferView | Blob | Request | Response | number
        ? number
        : undefined;
  }

  interface ResourceUsage {
    /**
     * The number of voluntary and involuntary context switches that the process made.
     */
    contextSwitches: {
      /**
       * Voluntary context switches (context switches that the process initiated).
       */
      voluntary: number;
      /**
       * Involuntary context switches (context switches initiated by the system scheduler).
       */
      involuntary: number;
    };

    /**
     * The amount of CPU time used by the process, in microseconds.
     */
    cpuTime: {
      /**
       * User CPU time used by the process, in microseconds.
       */
      user: number;
      /**
       * System CPU time used by the process, in microseconds.
       */
      system: number;
      /**
       * Total CPU time used by the process, in microseconds.
       */
      total: number;
    };
    /**
     * The maximum amount of resident set size (in bytes) used by the process during its lifetime.
     */
    maxRSS: number;

    /**
     * IPC messages sent and received by the process.
     */
    messages: {
      /**
       * The number of IPC messages sent.
       */
      sent: number;
      /**
       * The number of IPC messages received.
       */
      received: number;
    };
    /**
     * The number of IO operations done by the process.
     */
    ops: {
      /**
       * The number of input operations via the file system.
       */
      in: number;
      /**
       * The number of output operations via the file system.
       */
      out: number;
    };
    /**
     * The amount of shared memory that the process used.
     */
    shmSize: number;
    /**
     * The number of signals delivered to the process.
     */
    signalCount: number;
    /**
     *  The number of times the process was swapped out of main memory.
     */
    swapCount: number;
  }

  /**
   * A process created by {@link Bun.spawn}.
   *
   * This type accepts 3 optional type parameters which correspond to the `stdio` array from the options object. Instead of specifying these, you should use one of the following utility types instead:
   * - {@link ReadableSubprocess} (any, pipe, pipe)
   * - {@link WritableSubprocess} (pipe, any, any)
   * - {@link PipedSubprocess} (pipe, pipe, pipe)
   * - {@link NullSubprocess} (ignore, ignore, ignore)
   */
  interface Subprocess<
    In extends SpawnOptions.Writable = SpawnOptions.Writable,
    Out extends SpawnOptions.Readable = SpawnOptions.Readable,
    Err extends SpawnOptions.Readable = SpawnOptions.Readable,
  > extends AsyncDisposable {
    readonly stdin: SpawnOptions.WritableToIO<In>;
    readonly stdout: SpawnOptions.ReadableToIO<Out>;
    readonly stderr: SpawnOptions.ReadableToIO<Err>;

    /**
     * Access extra file descriptors passed to the `stdio` option in the options object.
     */
    readonly stdio: [null, null, null, ...number[]];

    /**
     * This returns the same value as {@link Subprocess.stdout}
     *
     * It exists for compatibility with {@link ReadableStream.pipeThrough}
     */
    readonly readable: SpawnOptions.ReadableToIO<Out>;

    /**
     * The process ID of the child process
     * @example
     * ```ts
     * const { pid } = Bun.spawn({ cmd: ["echo", "hello"] });
     * console.log(pid); // 1234
     * ```
     */
    readonly pid: number;

    /**
     * The exit code of the process
     *
     * The promise will resolve when the process exits
     */
    readonly exited: Promise<number>;

    /**
     * Synchronously get the exit code of the process
     *
     * If the process hasn't exited yet, this will return `null`
     */
    readonly exitCode: number | null;

    /**
     * Synchronously get the signal code of the process
     *
     * If the process never sent a signal code, this will return `null`
     *
     * To receive signal code changes, use the `onExit` callback.
     *
     * If the signal code is unknown, it will return the original signal code
     * number, but that case should essentially never happen.
     */
    readonly signalCode: NodeJS.Signals | null;

    /**
     * Has the process exited?
     */
    readonly killed: boolean;

    /**
     * Kill the process
     * @param exitCode The exitCode to send to the process
     */
    kill(exitCode?: number | NodeJS.Signals): void;

    /**
     * This method will tell Bun to wait for this process to exit after you already
     * called `unref()`.
     *
     * Before shutting down, Bun will wait for all subprocesses to exit by default
     */
    ref(): void;

    /**
     * Before shutting down, Bun will wait for all subprocesses to exit by default
     *
     * This method will tell Bun to not wait for this process to exit before shutting down.
     */
    unref(): void;

    /**
     * Send a message to the subprocess. This is only supported if the subprocess
     * was created with the `ipc` option, and is another instance of `bun`.
     *
     * Messages are serialized using the JSC serialize API, which allows for the same types that `postMessage`/`structuredClone` supports.
     */
    send(message: any): void;

    /**
     * Disconnect the IPC channel to the subprocess. This is only supported if the subprocess
     * was created with the `ipc` option.
     */
    disconnect(): void;

    /**
     * Get the resource usage information of the process (max RSS, CPU time, etc)
     *
     * Only available after the process has exited
     *
     * If the process hasn't exited yet, this will return `undefined`
     */
    resourceUsage(): ResourceUsage | undefined;
  }

  /**
   * A process created by {@link Bun.spawnSync}.
   *
   * This type accepts 2 optional type parameters which correspond to the `stdout` and `stderr` options. Instead of specifying these, you should use one of the following utility types instead:
   * - {@link ReadableSyncSubprocess} (pipe, pipe)
   * - {@link NullSyncSubprocess} (ignore, ignore)
   */
  interface SyncSubprocess<
    Out extends SpawnOptions.Readable = SpawnOptions.Readable,
    Err extends SpawnOptions.Readable = SpawnOptions.Readable,
  > {
    stdout: SpawnOptions.ReadableToSyncIO<Out>;
    stderr: SpawnOptions.ReadableToSyncIO<Err>;
    exitCode: number;
    success: boolean;
    /**
     * Get the resource usage information of the process (max RSS, CPU time, etc)
     */
    resourceUsage: ResourceUsage;

    signalCode?: string;
    exitedDueToTimeout?: boolean;
    exitedDueToMaxBuffer?: boolean;
    pid: number;
  }

  /**
   * Spawn a new process
   *
   * @category Process Management
   *
   * ```js
   * const subprocess = Bun.spawn({
   *  cmd: ["echo", "hello"],
   *  stdout: "pipe",
   * });
   * const text = await readableStreamToText(subprocess.stdout);
   * console.log(text); // "hello\n"
   * ```
   *
   * Internally, this uses [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
   */
  function spawn<
    const In extends SpawnOptions.Writable = "ignore",
    const Out extends SpawnOptions.Readable = "pipe",
    const Err extends SpawnOptions.Readable = "inherit",
  >(
    options: SpawnOptions.OptionsObject<In, Out, Err> & {
      /**
       * The command to run
       *
       * The first argument will be resolved to an absolute executable path. It must be a file, not a directory.
       *
       * If you explicitly set `PATH` in `env`, that `PATH` will be used to resolve the executable instead of the default `PATH`.
       *
       * To check if the command exists before running it, use `Bun.which(bin)`.
       *
       * @example
       * ```ts
       * const subprocess = Bun.spawn(["echo", "hello"]);
       * ```
       */
      cmd: string[]; // to support dynamically constructed commands
    },
  ): Subprocess<In, Out, Err>;

  /**
   * Spawn a new process
   *
   * ```js
   * const {stdout} = Bun.spawn(["echo", "hello"]);
   * const text = await readableStreamToText(stdout);
   * console.log(text); // "hello\n"
   * ```
   *
   * Internally, this uses [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
   */
  function spawn<
    const In extends SpawnOptions.Writable = "ignore",
    const Out extends SpawnOptions.Readable = "pipe",
    const Err extends SpawnOptions.Readable = "inherit",
  >(
    /**
     * The command to run
     *
     * The first argument will be resolved to an absolute executable path. It must be a file, not a directory.
     *
     * If you explicitly set `PATH` in `env`, that `PATH` will be used to resolve the executable instead of the default `PATH`.
     *
     * To check if the command exists before running it, use `Bun.which(bin)`.
     *
     * @example
     * ```ts
     * const subprocess = Bun.spawn(["echo", "hello"]);
     * ```
     */
    cmds: string[],
    options?: SpawnOptions.OptionsObject<In, Out, Err>,
  ): Subprocess<In, Out, Err>;

  /**
   * Spawn a new process
   *
   * @category Process Management
   *
   * ```js
   * const {stdout} = Bun.spawnSync({
   *  cmd: ["echo", "hello"],
   * });
   * console.log(stdout.toString()); // "hello\n"
   * ```
   *
   * Internally, this uses [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
   */
  function spawnSync<
    const Out extends SpawnOptions.Readable = "pipe",
    const Err extends SpawnOptions.Readable = "inherit",
  >(
    options: SpawnOptions.OptionsObject<"ignore", Out, Err> & {
      /**
       * The command to run
       *
       * The first argument will be resolved to an absolute executable path. It must be a file, not a directory.
       *
       * If you explicitly set `PATH` in `env`, that `PATH` will be used to resolve the executable instead of the default `PATH`.
       *
       * To check if the command exists before running it, use `Bun.which(bin)`.
       *
       * @example
       * ```ts
       * const subprocess = Bun.spawnSync({ cmd: ["echo", "hello"] });
       * ```
       */
      cmd: string[];

      onExit?: never;
    },
  ): SyncSubprocess<Out, Err>;

  /**
   * Synchronously spawn a new process
   *
   * ```js
   * const {stdout} = Bun.spawnSync(["echo", "hello"]);
   * console.log(stdout.toString()); // "hello\n"
   * ```
   *
   * Internally, this uses [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
   */
  function spawnSync<
    const Out extends SpawnOptions.Readable = "pipe",
    const Err extends SpawnOptions.Readable = "inherit",
  >(
    /**
     * The command to run
     *
     * The first argument will be resolved to an absolute executable path. It must be a file, not a directory.
     *
     * If you explicitly set `PATH` in `env`, that `PATH` will be used to resolve the executable instead of the default `PATH`.
     *
     * To check if the command exists before running it, use `Bun.which(bin)`.
     *
     * @example
     * ```ts
     * const subprocess = Bun.spawnSync(["echo", "hello"]);
     * ```
     */
    cmds: string[],
    options?: SpawnOptions.OptionsObject<"ignore", Out, Err>,
  ): SyncSubprocess<Out, Err>;

  /** Utility type for any process from {@link Bun.spawn()} with both stdout and stderr set to `"pipe"` */
  type ReadableSubprocess = Subprocess<any, "pipe", "pipe">;
  /** Utility type for any process from {@link Bun.spawn()} with stdin set to `"pipe"` */
  type WritableSubprocess = Subprocess<"pipe", any, any>;
  /** Utility type for any process from {@link Bun.spawn()} with stdin, stdout, stderr all set to `"pipe"`. A combination of {@link ReadableSubprocess} and {@link WritableSubprocess} */
  type PipedSubprocess = Subprocess<"pipe", "pipe", "pipe">;
  /** Utility type for any process from {@link Bun.spawn()} with stdin, stdout, stderr all set to `null` or similar. */
  type NullSubprocess = Subprocess<
    "ignore" | "inherit" | null | undefined,
    "ignore" | "inherit" | null | undefined,
    "ignore" | "inherit" | null | undefined
  >;
  /** Utility type for any process from {@link Bun.spawnSync()} with both stdout and stderr set to `"pipe"` */
  type ReadableSyncSubprocess = SyncSubprocess<"pipe", "pipe">;
  /** Utility type for any process from {@link Bun.spawnSync()} with both stdout and stderr set to `null` or similar */
  type NullSyncSubprocess = SyncSubprocess<
    "ignore" | "inherit" | null | undefined,
    "ignore" | "inherit" | null | undefined
  >;

  // Blocked on https://github.com/oven-sh/bun/issues/8329
  // /**
  //  *
  //  * Count the visible width of a string, as it would be displayed in a terminal.
  //  *
  //  * By default, strips ANSI escape codes before measuring the string. This is
  //  * because ANSI escape codes are not visible characters. If passed a non-string,
  //  * it will return 0.
  //  *
  //  * @param str The string to measure
  //  * @param options
  //  */
  // function stringWidth(
  //   str: string,
  //   options?: {
  //     /**
  //      * Whether to include ANSI escape codes in the width calculation
  //      *
  //      * Slightly faster if set to `false`, but less accurate if the string contains ANSI escape codes.
  //      * @default false
  //      */
  //     countAnsiEscapeCodes?: boolean;
  //   },
  // ): number;

  class FileSystemRouter {
    /**
     * Create a new {@link FileSystemRouter}.
     *
     * @example
     * ```ts
     * const router = new FileSystemRouter({
     *   dir: process.cwd() + "/pages",
     *   style: "nextjs",
     * });
     *
     * const {params} = router.match("/blog/2020/01/01/hello-world");
     * console.log(params); // {year: "2020", month: "01", day: "01", slug: "hello-world"}
     * ```
     * @param options The options to use when creating the router
     * @param options.dir The root directory containing the files to route
     * @param options.style The style of router to use (only "nextjs" supported
     * for now)
     */
    constructor(options: {
      /**
       * The root directory containing the files to route
       *
       * There is no default value for this option.
       *
       * @example
       *   ```ts
       *   const router = new FileSystemRouter({
       *   dir:
       */
      dir: string;
      style: "nextjs";

      /** The base path to use when routing */
      assetPrefix?: string;
      origin?: string;
      /** Limit the pages to those with particular file extensions. */
      fileExtensions?: string[];
    });

    // todo: URL
    match(input: string | Request | Response): MatchedRoute | null;

    readonly assetPrefix: string;
    readonly origin: string;
    readonly style: string;
    readonly routes: Record<string, string>;

    reload(): void;
  }

  interface MatchedRoute {
    /**
     * A map of the parameters from the route
     *
     * @example
     * ```ts
     * const router = new FileSystemRouter({
     *   dir: "/path/to/files",
     *   style: "nextjs",
     * });
     * const {params} = router.match("/blog/2020/01/01/hello-world");
     * console.log(params.year); // "2020"
     * console.log(params.month); // "01"
     * console.log(params.day); // "01"
     * console.log(params.slug); // "hello-world"
     * ```
     */
    readonly params: Record<string, string>;
    readonly filePath: string;
    readonly pathname: string;
    readonly query: Record<string, string>;
    readonly name: string;
    readonly kind: "exact" | "catch-all" | "optional-catch-all" | "dynamic";
    readonly src: string;
  }

  /**
   * The current version of Bun
   * @example
   * "1.2.0"
   */
  const version: string;

  /**
   * The current version of Bun with the shortened commit sha of the build
   * @example "v1.2.0 (a1b2c3d4)"
   */
  const version_with_sha: string;

  /**
   * The git sha at the time the currently-running version of Bun was compiled
   * @example
   * "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   */
  const revision: string;

  /**
   * Find the index of a newline character in potentially ill-formed UTF-8 text.
   *
   * This is sort of like readline() except without the IO.
   */
  function indexOfLine(buffer: ArrayBufferView | ArrayBufferLike, offset?: number): number;

  interface GlobScanOptions {
    /**
     * The root directory to start matching from. Defaults to `process.cwd()`
     */
    cwd?: string;

    /**
     * Allow patterns to match entries that begin with a period (`.`).
     *
     * @default false
     */
    dot?: boolean;

    /**
     * Return the absolute path for entries.
     *
     * @default false
     */
    absolute?: boolean;

    /**
     * Indicates whether to traverse descendants of symbolic link directories.
     *
     * @default false
     */
    followSymlinks?: boolean;

    /**
     * Throw an error when symbolic link is broken
     *
     * @default false
     */
    throwErrorOnBrokenSymlink?: boolean;

    /**
     * Return only files.
     *
     * @default true
     */
    onlyFiles?: boolean;
  }

  /**
   * Match files using [glob patterns](https://en.wikipedia.org/wiki/Glob_(programming)).
   *
   * The supported pattern syntax for is:
   *
   * - `?`
   *     Matches any single character.
   * - `*`
   *     Matches zero or more characters, except for path separators ('/' or '\').
   * - `**`
   *     Matches zero or more characters, including path separators.
   *     Must match a complete path segment, i.e. followed by a path separator or
   *     at the end of the pattern.
   * - `[ab]`
   *     Matches one of the characters contained in the brackets.
   *     Character ranges (e.g. "[a-z]") are also supported.
   *     Use "[!ab]" or "[^ab]" to match any character *except* those contained
   *     in the brackets.
   * - `{a,b}`
   *     Match one of the patterns contained in the braces.
   *     Any of the wildcards listed above can be used in the sub patterns.
   *     Braces may be nested up to 10 levels deep.
   * - `!`
   *     Negates the result when at the start of the pattern.
   *     Multiple "!" characters negate the pattern multiple times.
   * - `\`
   *     Used to escape any of the special characters above.
   *
   * @example
   * ```js
   * const glob = new Glob("*.{ts,tsx}");
   * const scannedFiles = await Array.fromAsync(glob.scan({ cwd: './src' }))
   * ```
   */
  export class Glob {
    constructor(pattern: string);

    /**
     * Scan a root directory recursively for files that match this glob pattern. Returns an async iterator.
     *
     * @throws {ENOTDIR} Given root cwd path must be a directory
     *
     * @example
     * ```js
     * const glob = new Glob("*.{ts,tsx}");
     * const scannedFiles = await Array.fromAsync(glob.scan({ cwd: './src' }))
     * ```
     *
     * @example
     * ```js
     * const glob = new Glob("*.{ts,tsx}");
     * for await (const path of glob.scan()) {
     *   // do something
     * }
     * ```
     */
    scan(optionsOrCwd?: string | GlobScanOptions): AsyncIterableIterator<string>;

    /**
     * Synchronously scan a root directory recursively for files that match this glob pattern. Returns an iterator.
     *
     * @throws {ENOTDIR} Given root cwd path must be a directory
     *
     * @example
     * ```js
     * const glob = new Glob("*.{ts,tsx}");
     * const scannedFiles = Array.from(glob.scan({ cwd: './src' }))
     * ```
     *
     * @example
     * ```js
     * const glob = new Glob("*.{ts,tsx}");
     * for (const path of glob.scan()) {
     *   // do something
     * }
     * ```
     */
    scanSync(optionsOrCwd?: string | GlobScanOptions): IterableIterator<string>;

    /**
     * Match the glob against a string
     *
     * @example
     * ```js
     * const glob = new Glob("*.{ts,tsx}");
     * expect(glob.match('foo.ts')).toBeTrue();
     * ```
     */
    match(str: string): boolean;
  }

  /**
   * Generate a UUIDv7, which is a sequential ID based on the current timestamp with a random component.
   *
   * When the same timestamp is used multiple times, a monotonically increasing
   * counter is appended to allow sorting. The final 8 bytes are
   * cryptographically random. When the timestamp changes, the counter resets to
   * a psuedo-random integer.
   *
   * @param encoding "hex" | "base64" | "base64url"
   * @param timestamp Unix timestamp in milliseconds, defaults to `Date.now()`
   *
   * @example
   * ```js
   * import { randomUUIDv7 } from "bun";
   * const array = [
   *   randomUUIDv7(),
   *   randomUUIDv7(),
   *   randomUUIDv7(),
   * ]
   * [
   *   "0192ce07-8c4f-7d66-afec-2482b5c9b03c",
   *   "0192ce07-8c4f-7d67-805f-0f71581b5622",
   *   "0192ce07-8c4f-7d68-8170-6816e4451a58"
   * ]
   * ```
   */
  function randomUUIDv7(
    /**
     * @default "hex"
     */
    encoding?: "hex" | "base64" | "base64url",
    /**
     * @default Date.now()
     */
    timestamp?: number | Date,
  ): string;

  /**
   * Generate a UUIDv7 as a Buffer
   *
   * @param encoding "buffer"
   * @param timestamp Unix timestamp in milliseconds, defaults to `Date.now()`
   */
  function randomUUIDv7(
    encoding: "buffer",
    /**
     * @default Date.now()
     */
    timestamp?: number | Date,
  ): Buffer;

  /**
   * Generate a UUIDv5, which is a name-based UUID based on the SHA-1 hash of a namespace UUID and a name.
   *
   * @param name The name to use for the UUID
   * @param namespace The namespace to use for the UUID
   * @param encoding The encoding to use for the UUID
   *
   *
   * @example
   * ```js
   * import { randomUUIDv5 } from "bun";
   * const uuid = randomUUIDv5("www.example.com", "dns");
   * console.log(uuid); // "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
   * ```
   *
   * ```js
   * import { randomUUIDv5 } from "bun";
   * const uuid = randomUUIDv5("www.example.com", "url");
   * console.log(uuid); // "6ba7b811-9dad-11d1-80b4-00c04fd430c8"
   * ```
   */
  function randomUUIDv5(
    name: string | BufferSource,
    namespace: string | BufferSource | "dns" | "url" | "oid" | "x500",
    /**
     * @default "hex"
     */
    encoding?: "hex" | "base64" | "base64url",
  ): string;

  /**
   * Generate a UUIDv5 as a Buffer
   *
   * @param name The name to use for the UUID
   * @param namespace The namespace to use for the UUID
   * @param encoding The encoding to use for the UUID
   *
   * @example
   * ```js
   * import { randomUUIDv5 } from "bun";
   * const uuid = randomUUIDv5("www.example.com", "url", "buffer");
   * console.log(uuid); // <Buffer 6b a7 b8 11 9d ad 11 d1 80 b4 00 c0 4f d4 30 c8>
   * ```
   */
  function randomUUIDv5(
    name: string | BufferSource,
    namespace: string | BufferSource | "dns" | "url" | "oid" | "x500",
    encoding: "buffer",
  ): Buffer;

  /**
   * Types for `bun.lock`
   */
  type BunLockFile = {
    lockfileVersion: 0 | 1;
    workspaces: {
      [workspace: string]: BunLockFileWorkspacePackage;
    };
    /** @see https://bun.sh/docs/install/overrides */
    overrides?: Record<string, string>;
    /** @see https://bun.sh/docs/install/patch */
    patchedDependencies?: Record<string, string>;
    /** @see https://bun.sh/docs/install/lifecycle#trusteddependencies */
    trustedDependencies?: string[];
    /** @see https://bun.sh/docs/install/catalogs */
    catalog?: Record<string, string>;
    /** @see https://bun.sh/docs/install/catalogs */
    catalogs?: Record<string, Record<string, string>>;

    /**
     * ```
     * INFO = { prod/dev/optional/peer dependencies, os, cpu, libc (TODO), bin, binDir }
     *
     * // first index is resolution for each type of package
     * npm         -> [ "name@version", registry (TODO: remove if default), INFO, integrity]
     * symlink     -> [ "name@link:path", INFO ]
     * folder      -> [ "name@file:path", INFO ]
     * workspace   -> [ "name@workspace:path" ] // workspace is only path
     * tarball     -> [ "name@tarball", INFO ]
     * root        -> [ "name@root:", { bin, binDir } ]
     * git         -> [ "name@git+repo", INFO, .bun-tag string (TODO: remove this) ]
     * github      -> [ "name@github:user/repo", INFO, .bun-tag string (TODO: remove this) ]
     * ```
     * */
    packages: {
      [pkg: string]: BunLockFilePackageArray;
    };
  };

  type BunLockFileBasePackageInfo = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalPeers?: string[];
    bin?: string | Record<string, string>;
    binDir?: string;
  };

  type BunLockFileWorkspacePackage = BunLockFileBasePackageInfo & {
    name?: string;
    version?: string;
  };

  type BunLockFilePackageInfo = BunLockFileBasePackageInfo & {
    os?: string | string[];
    cpu?: string | string[];
    bundled?: true;
  };

  /** @see {@link BunLockFile.packages} for more info */
  type BunLockFilePackageArray =
    /** npm */
    | [pkg: string, registry: string, info: BunLockFilePackageInfo, integrity: string]
    /** symlink, folder, tarball */
    | [pkg: string, info: BunLockFilePackageInfo]
    /** workspace */
    | [pkg: string]
    /** git, github */
    | [pkg: string, info: BunLockFilePackageInfo, bunTag: string]
    /** root */
    | [pkg: string, info: Pick<BunLockFileBasePackageInfo, "bin" | "binDir">];

  interface CookieInit {
    name?: string;
    value?: string;
    domain?: string;
    /** Defaults to '/'. To allow the browser to set the path, use an empty string. */
    path?: string;
    expires?: number | Date | string;
    secure?: boolean;
    /** Defaults to `lax`. */
    sameSite?: CookieSameSite;
    httpOnly?: boolean;
    partitioned?: boolean;
    maxAge?: number;
  }

  interface CookieStoreDeleteOptions {
    name: string;
    domain?: string | null;
    path?: string;
  }

  interface CookieStoreGetOptions {
    name?: string;
    url?: string;
  }

  type CookieSameSite = "strict" | "lax" | "none";

  /**
   * A class for working with a single cookie
   *
   * @example
   * ```js
   * const cookie = new Bun.Cookie("name", "value");
   * console.log(cookie.toString()); // "name=value; Path=/; SameSite=Lax"
   * ```
   */
  class Cookie {
    /**
     * Create a new cookie
     * @param name - The name of the cookie
     * @param value - The value of the cookie
     * @param options - Optional cookie attributes
     */
    constructor(name: string, value: string, options?: CookieInit);

    /**
     * Create a new cookie from a cookie string
     * @param cookieString - The cookie string
     */
    constructor(cookieString: string);

    /**
     * Create a new cookie from a cookie object
     * @param cookieObject - The cookie object
     */
    constructor(cookieObject?: CookieInit);

    /**
     * The name of the cookie
     */
    readonly name: string;

    /**
     * The value of the cookie
     */
    value: string;

    /**
     * The domain of the cookie
     */
    domain?: string;

    /**
     * The path of the cookie
     */
    path: string;

    /**
     * The expiration date of the cookie
     */
    expires?: Date;

    /**
     * Whether the cookie is secure
     */
    secure: boolean;

    /**
     * The same-site attribute of the cookie
     */
    sameSite: CookieSameSite;

    /**
     * Whether the cookie is partitioned
     */
    partitioned: boolean;

    /**
     * The maximum age of the cookie in seconds
     */
    maxAge?: number;

    /**
     * Whether the cookie is HTTP-only
     */
    httpOnly: boolean;

    /**
     * Whether the cookie is expired
     */
    isExpired(): boolean;

    /**
     * Serialize the cookie to a string
     *
     * @example
     * ```ts
     * const cookie = Bun.Cookie.from("session", "abc123", {
     *   domain: "example.com",
     *   path: "/",
     *   secure: true,
     *   httpOnly: true
     * }).serialize(); // "session=abc123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax"
     * ```
     */
    serialize(): string;

    /**
     * Serialize the cookie to a string
     *
     * Alias of {@link Cookie.serialize}
     */
    toString(): string;

    /**
     * Serialize the cookie to a JSON object
     */
    toJSON(): CookieInit;

    /**
     * Parse a cookie string into a Cookie object
     * @param cookieString - The cookie string
     */
    static parse(cookieString: string): Cookie;

    /**
     * Create a new cookie from a name and value and optional options
     */
    static from(name: string, value: string, options?: CookieInit): Cookie;
  }

  /**
   * A Map-like interface for working with collections of cookies.
   *
   * Implements the `Iterable` interface, allowing use with `for...of` loops.
   */
  class CookieMap implements Iterable<[string, string]> {
    /**
     * Creates a new CookieMap instance.
     *
     * @param init - Optional initial data for the cookie map:
     *   - string: A cookie header string (e.g., "name=value; foo=bar")
     *   - string[][]: An array of name/value pairs (e.g., [["name", "value"], ["foo", "bar"]])
     *   - Record<string, string>: An object with cookie names as keys (e.g., { name: "value", foo: "bar" })
     */
    constructor(init?: string[][] | Record<string, string> | string);

    /**
     * Gets the value of a cookie with the specified name.
     *
     * @param name - The name of the cookie to retrieve
     * @returns The cookie value as a string, or null if the cookie doesn't exist
     */
    get(name: string): string | null;

    /**
     * Gets an array of values for Set-Cookie headers in order to apply all changes to cookies.
     *
     * @returns An array of values for Set-Cookie headers
     */
    toSetCookieHeaders(): string[];

    /**
     * Checks if a cookie with the given name exists.
     *
     * @param name - The name of the cookie to check
     * @returns true if the cookie exists, false otherwise
     */
    has(name: string): boolean;

    /**
     * Adds or updates a cookie in the map.
     *
     * @param name - The name of the cookie
     * @param value - The value of the cookie
     * @param options - Optional cookie attributes
     */
    set(name: string, value: string, options?: CookieInit): void;

    /**
     * Adds or updates a cookie in the map using a cookie options object.
     *
     * @param options - Cookie options including name and value
     */
    set(options: CookieInit): void;

    /**
     * Removes a cookie from the map.
     *
     * @param name - The name of the cookie to delete
     */
    delete(name: string): void;

    /**
     * Removes a cookie from the map.
     *
     * @param options - The options for the cookie to delete
     */
    delete(options: CookieStoreDeleteOptions): void;

    /**
     * Removes a cookie from the map.
     *
     * @param name - The name of the cookie to delete
     * @param options - The options for the cookie to delete
     */
    delete(name: string, options: Omit<CookieStoreDeleteOptions, "name">): void;

    /**
     * Converts the cookie map to a serializable format.
     *
     * @returns An array of name/value pairs
     */
    toJSON(): Record<string, string>;

    /**
     * The number of cookies in the map.
     */
    readonly size: number;

    /**
     * Returns an iterator of [name, value] pairs for every cookie in the map.
     *
     * @returns An iterator for the entries in the map
     */
    entries(): IterableIterator<[string, string]>;

    /**
     * Returns an iterator of all cookie names in the map.
     *
     * @returns An iterator for the cookie names
     */
    keys(): IterableIterator<string>;

    /**
     * Returns an iterator of all cookie values in the map.
     *
     * @returns An iterator for the cookie values
     */
    values(): IterableIterator<string>;

    /**
     * Executes a provided function once for each cookie in the map.
     *
     * @param callback - Function to execute for each entry
     */
    forEach(callback: (value: string, key: string, map: CookieMap) => void): void;

    /**
     * Returns the default iterator for the CookieMap.
     * Used by for...of loops to iterate over all entries.
     *
     * @returns An iterator for the entries in the map
     */
    [Symbol.iterator](): IterableIterator<[string, string]>;
  }
}
