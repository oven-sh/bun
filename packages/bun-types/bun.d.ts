/**
 * Bun runtime APIs
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
  type PathLike = string | NodeJS.TypedArray | ArrayBufferLike | URL;
  type ArrayBufferView<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> =
    | NodeJS.TypedArray<TArrayBuffer>
    | DataView<TArrayBuffer>;
  type BufferSource = NodeJS.TypedArray<ArrayBufferLike> | DataView<ArrayBufferLike> | ArrayBufferLike;
  type StringOrBuffer = string | NodeJS.TypedArray | ArrayBufferLike;
  type XMLHttpRequestBodyInit = Blob | BufferSource | FormData | URLSearchParams | string;
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
     * Uses the lib.dom.d.ts definition of a global if it exists, otherwise falls back to `Otherwise`.
     *
     * Some symbols can't be declared in a way that satisfies both \@types/bun and lib.dom.d.ts,
     * so when lib.dom.d.ts is loaded, its definition wins.
     */
    type UseLibDomIfAvailable<GlobalThisKeyName extends PropertyKey, Otherwise> =
      // `onabort` is defined in lib.dom.d.ts, so we can check to see if lib dom is loaded by checking if `onabort` is defined
      LibDomIsLoaded extends true
        ? typeof globalThis extends { [K in GlobalThisKeyName]: infer T } // if it is loaded, infer it from `globalThis` and use that value
          ? T
          : Otherwise // Not defined in lib dom (or anywhere else), so no conflict. We can safely use our own definition
        : Otherwise; // Lib dom not loaded anyway, so no conflict. We can safely use our own definition

    /**
     * Like Omit, but correctly distributes over unions. Most useful for removing
     * properties from union options objects, like {@link Bun.SQL.Options}
     *
     * @example
     * ```ts
     * type X = Bun.DistributedOmit<{type?: 'a', url?: string} | {type?: 'b', flag?: boolean}, "url">
     * // `{type?: 'a'} | {type?: 'b', flag?: boolean}` (Omit applied to each union item instead of entire type)
     *
     * type X = Omit<{type?: 'a', url?: string} | {type?: 'b', flag?: boolean}, "url">;
     * // `{type?: "a" | "b" | undefined}` (Missing `flag` property and no longer a union)
     * ```
     */
    type DistributedOmit<T, K extends PropertyKey> = T extends T ? Omit<T, K> : never;

    type KeysInBoth<A, B> = Extract<keyof A, keyof B>;
    type MergeInner<A, B> = Omit<A, KeysInBoth<A, B>> &
      Omit<B, KeysInBoth<A, B>> & {
        [Key in KeysInBoth<A, B>]: A[Key] | B[Key];
      };
    type Merge<A, B> = MergeInner<A, B> & MergeInner<B, A>;
    type DistributedMerge<T, Else = T> = T extends T ? Merge<T, Exclude<Else, T>> : never;

    type Without<A, B> = A & {
      [Key in Exclude<keyof B, keyof A>]?: never;
    };

    type XOR<A, B> = Without<A, B> | Without<B, A>;
  }

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
    /** Returns the state of this EventSource object's connection: `CONNECTING` (0), `OPEN` (1), or `CLOSED` (2). */
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
     * Keep the event loop alive while the connection is open or reconnecting
     *
     * Not available in browsers
     */
    ref(): void;

    /**
     * Do not keep the event loop alive while the connection is open or reconnecting
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
     * Mode "bytes" is not supported.
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
     * An identifying name for the worker's `DedicatedWorkerGlobalScope`, mainly
     * useful for debugging.
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
     * When `true`, the worker keeps the parent thread alive until the worker is terminated or `unref`'d.
     * When `false`, it does not.
     *
     * @default false
     */
    ref?: boolean;

    /**
     * In Bun, this does nothing.
     */
    type?: Bun.WorkerType | undefined;

    /**
     * List of arguments to stringify and append to `Bun.argv` / `process.argv`
     * in the worker. The values are available on the global `Bun.argv` as if
     * they were passed as CLI options to the script.
     */
    argv?: any[] | undefined;

    /** If `true` and the first argument is a string, interpret the first argument to the constructor as a script that is executed once the worker is online. */
    // eval?: boolean | undefined;

    /**
     * If set, the initial value of `process.env` inside the Worker thread. Pass `worker.SHARE_ENV`
     * from `node:worker_threads` to share environment variables between the parent and worker threads;
     * changes to one thread's `process.env` then affect the other thread as well. Default: `process.env`.
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
     * Opposite of `unref()`: calling `ref()` on a previously `unref()`ed worker does _not_ let the
     * program exit if it's the only active handle left (the default behavior).
     * If the worker is already `ref()`ed, calling `ref()` again has no effect.
     */
    ref(): void;

    /**
     * Calling `unref()` on a worker allows the thread to exit if this is the only
     * active handle in the event system. If the worker is already `unref()`ed,
     * calling `unref()` again has no effect.
     */
    unref(): void;

    /**
     * An integer identifier for the referenced thread. Inside the worker thread,
     * it is available as `require('node:worker_threads').threadId`.
     * This value is unique for each `Worker` instance inside a single process.
     */
    threadId: number;
  }

  interface Env {
    NODE_ENV?: string;
    /**
     * Set to change the default timezone at runtime
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
   * The raw arguments passed to the process, including flags passed to Bun.
   * To read the flags passed to your script, use `process.argv` instead.
   */
  const argv: string[];

  interface WhichOptions {
    /**
     * Overrides the `PATH` environment variable
     */
    PATH?: string;

    /**
     * When `command` is a relative path, resolve it against this directory.
     */
    cwd?: string;
  }

  /**
   * Find the path to an executable, like the `which` command in your terminal.
   * Reads the `PATH` environment variable unless overridden with `options.PATH`.
   *
   * @category Utilities
   *
   * @param command The name of the executable or script to find
   * @param options Options for the search
   * @returns The path to the executable, or `null` if it isn't found
   */
  function which(command: string, options?: WhichOptions): string | null;

  interface StringWidthOptions {
    /**
     * If `true`, count ANSI escape codes as part of the string width. If `false`, ignore them.
     *
     * @default false
     */
    countAnsiEscapeCodes?: boolean;

    /**
     * If `true`, count ambiguous-width characters as 1 character wide. If `false`, count them as 2 characters wide.
     *
     * @default true
     */
    ambiguousIsNarrow?: boolean;
  }

  /**
   * Get the column count of a string as it would be displayed in a terminal.
   * Supports ANSI escape codes, emoji, and wide characters.
   *
   * This API is designed to match the `string-width` npm package, so existing
   * code can be ported in either direction.
   *
   * @category Utilities
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
   * Remove ANSI escape codes from a string.
   *
   * @category Utilities
   *
   * @param input The string to remove ANSI escape codes from.
   * @returns The string with ANSI escape codes removed.
   *
   * @example
   * ```ts
   * import { stripANSI } from "bun";
   *
   * console.log(stripANSI("\u001b[31mhello\u001b[39m")); // "hello"
   * ```
   */
  function stripANSI(input: string): string;

  interface SliceAnsiOptions {
    /**
     * If set, and content was cut at either edge of the requested range,
     * insert this string at the cut edge(s). The ellipsis is counted against
     * the visible-width budget and is emitted *inside* any active SGR styles
     * (color, bold, etc.) so it inherits them, but *outside* any active OSC 8
     * hyperlink.
     *
     * This turns `sliceAnsi` into a drop-in `cli-truncate` replacement:
     * - truncate-end: `sliceAnsi(str, 0, max, { ellipsis: "\u2026" })`
     * - truncate-start: `sliceAnsi(str, -max, undefined, { ellipsis: "\u2026" })`
     */
    ellipsis?: string;

    /**
     * Count characters with East Asian Width "Ambiguous" as 1 column (narrow)
     * instead of 2 (wide). Affects Greek, Cyrillic, some symbols, etc. that
     * render wide in CJK-encoded terminals but narrow in Western ones.
     *
     * Matches the option of the same name in {@link stringWidth} and
     * {@link wrapAnsi}.
     *
     * @default true
     */
    ambiguousIsNarrow?: boolean;
  }

  /**
   * Slice a string by visible column width, preserving ANSI escape codes.
   *
   * Like `String.prototype.slice`, but indices are terminal column widths
   * (accounting for wide CJK characters, emoji grapheme clusters, and
   * zero-width joiners), and ANSI escape sequences (SGR colors, OSC 8
   * hyperlinks, etc.) are preserved and correctly re-opened/closed at the
   * slice boundaries.
   *
   * @category Utilities
   *
   * @param input The string to slice
   * @param start Starting column (default 0). Negative counts from end.
   * @param end Ending column, exclusive (default end of string). Negative counts from end.
   * @param options Optional behavior flags (such as `ellipsis` for truncation)
   * @returns The sliced string with ANSI codes intact
   *
   * @example
   * ```ts
   * import { sliceAnsi } from "bun";
   *
   * // Plain slice (replaces the `slice-ansi` npm package)
   * sliceAnsi("hello", 1, 4);                              // "ell"
   * sliceAnsi("\u001b[31mhello\u001b[39m", 1, 4);          // "\u001b[31mell\u001b[39m"
   * sliceAnsi("\u5b89\u5b81\u54c8", 0, 4);                 // "\u5b89\u5b81" (CJK: width 2 each)
   *
   * // Truncation (replaces the `cli-truncate` npm package)
   * sliceAnsi("unicorn", 0, 4, "\u2026");           // "uni\u2026"
   * sliceAnsi("unicorn", -4, undefined, "\u2026");  // "\u2026orn"
   * ```
   */
  function sliceAnsi(
    input: string,
    start?: number,
    end?: number,
    /**
     * Shorthand for common options (avoids `{}` allocation):
     * - `string` → ellipsis (equivalent to `{ ellipsis: string }`)
     * - `boolean` → ambiguousIsNarrow (equivalent to `{ ambiguousIsNarrow: boolean }`)
     * - `SliceAnsiOptions` → full options object
     */
    options?: string | boolean | SliceAnsiOptions,
    /**
     * ambiguousIsNarrow as a positional arg, usable when the 4th arg is an
     * ellipsis string (or `undefined`). Lets you pass both options without
     * an object: `sliceAnsi(s, 0, n, "\u2026", false)`.
     */
    ambiguousIsNarrow?: boolean,
  ): string;

  interface WrapAnsiOptions {
    /**
     * If `true`, break words in the middle if they don't fit on a line.
     * If `false`, only break at word boundaries.
     *
     * @default false
     */
    hard?: boolean;

    /**
     * If `true`, wrap at word boundaries when possible.
     * If `false`, break every line at exactly the column width (characters
     * are split wherever the limit falls, ignoring word boundaries).
     *
     * @default true
     */
    wordWrap?: boolean;

    /**
     * If `true`, trim leading and trailing whitespace from each line.
     * If `false`, preserve whitespace.
     *
     * @default true
     */
    trim?: boolean;

    /**
     * If `true`, count ambiguous-width characters as 1 character wide.
     * If `false`, count them as 2 characters wide.
     *
     * @default true
     */
    ambiguousIsNarrow?: boolean;
  }

  /**
   * Wrap a string to fit within the specified column width, preserving ANSI escape codes.
   *
   * Designed to be compatible with the `wrap-ansi` npm package.
   *
   * Features:
   * - Preserves ANSI escape codes (colors, styles) across line breaks
   * - Supports SGR codes (colors, bold, italic, etc.) and OSC 8 hyperlinks
   * - Respects Unicode display widths (full-width characters, emoji)
   * - Word wrapping at word boundaries (configurable)
   *
   * @category Utilities
   *
   * @param input The string to wrap
   * @param columns The maximum column width
   * @param options Wrapping options
   * @returns The wrapped string
   *
   * @example
   * ```ts
   * import { wrapAnsi } from "bun";
   *
   * console.log(wrapAnsi("hello world", 5));
   * // Output:
   * // hello
   * // world
   *
   * // Preserves ANSI colors across line breaks
   * console.log(wrapAnsi("\u001b[31mhello world\u001b[0m", 5));
   * // Output:
   * // \u001b[31mhello\u001b[0m
   * // \u001b[31mworld\u001b[0m
   *
   * // Hard wrap long words
   * console.log(wrapAnsi("abcdefghij", 3, { hard: true }));
   * // Output:
   * // abc
   * // def
   * // ghi
   * // j
   * ```
   */
  function wrapAnsi(
    /**
     * The string to wrap
     */
    input: string,
    /**
     * The maximum column width
     */
    columns: number,
    /**
     * Wrapping options
     */
    options?: WrapAnsiOptions,
  ): string;

  /**
   * TOML related APIs
   */
  namespace TOML {
    /**
     * Parse a TOML (v1.1.0) document into a JavaScript object.
     *
     * Date/time values parse as strings of their source text. Integers
     * outside `Number.MAX_SAFE_INTEGER` throw, since they cannot be
     * represented losslessly as JavaScript numbers.
     *
     * @category Utilities
     *
     * @param input The TOML document to parse, as a string or UTF-8 bytes
     * @returns A JavaScript object
     * @throws {SyntaxError} If the input is not valid TOML
     */
    export function parse(
      input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike | Blob,
    ): object;

    /**
     * Serialize a JavaScript object to a TOML document.
     *
     * The top-level value must be an object (a TOML document is a table).
     * `Date` values become TOML offset date-times. `null`, `BigInt`, and
     * circular structures throw, since TOML cannot represent them;
     * `undefined`, function, and symbol properties are skipped (inside
     * arrays they throw, since TOML arrays cannot have holes).
     *
     * @category Utilities
     *
     * @param input The JavaScript object to serialize.
     * @param replacer Not supported; pass `undefined` or `null`.
     * @param space Accepted for signature parity with `YAML.stringify` and
     * `JSON5.stringify`, but ignored: TOML output is line-oriented.
     * @returns A TOML document string, or `undefined` if the input is `undefined`, a function, or a symbol.
     *
     * @example
     * ```js
     * import { TOML } from "bun";
     * TOML.stringify({ name: "app", server: { port: 8080 } });
     * // 'name = "app"\n\n[server]\nport = 8080\n'
     * ```
     */
    export function stringify(input: unknown, replacer?: undefined | null, space?: string | number): string | undefined;
  }

  /**
   * JSONC related APIs
   */
  namespace JSONC {
    /**
     * Parse a JSONC (JSON with Comments) string into a JavaScript value.
     *
     * Supports both single-line (`//`) and block comments (`/* ... *\/`), as well as
     * trailing commas in objects and arrays.
     *
     * @category Utilities
     *
     * @param input The JSONC string to parse
     * @returns A JavaScript value
     *
     * @example
     * ```js
     * const result = Bun.JSONC.parse(`{
     *   // This is a comment
     *   "name": "my-app",
     *   "version": "1.0.0", // trailing comma is allowed
     * }`);
     * ```
     */
    export function parse(input: string): unknown;
  }

  /**
   * JSONL (JSON Lines) related APIs.
   *
   * Each line of the input is a JSON value.
   */
  namespace JSONL {
    /**
     * The result of `Bun.JSONL.parseChunk`.
     */
    interface ParseChunkResult {
      /** The successfully parsed JSON values. */
      values: unknown[];
      /** How much of the input was consumed. When the input is a string, this is a character offset. When the input is a `TypedArray`, this is a byte offset. Use `input.slice(read)` or `input.subarray(read)` to get the unconsumed remainder. */
      read: number;
      /** `true` if all input was consumed successfully. `false` if the input ends with an incomplete value or a parse error occurred. */
      done: boolean;
      /** A `SyntaxError` if a parse error occurred, otherwise `null`. Values parsed before the error are still available in `values`. */
      error: SyntaxError | null;
    }

    /**
     * Parse a JSONL (JSON Lines) string into an array of JavaScript values.
     *
     * If a parse error occurs and no values were successfully parsed, throws
     * a `SyntaxError`. If values were parsed before the error, returns the
     * successfully parsed values without throwing.
     *
     * Incomplete trailing values (for example, from a partial chunk) are
     * silently ignored.
     *
     * When a `TypedArray` is passed, the bytes are parsed directly without
     * copying if the content is ASCII.
     *
     * @param input The JSONL string or typed array to parse
     * @returns An array of parsed values
     * @throws {SyntaxError} If the input starts with invalid JSON and no values could be parsed
     *
     * @example
     * ```js
     * const items = Bun.JSONL.parse('{"a":1}\n{"b":2}\n');
     * // [{ a: 1 }, { b: 2 }]
     *
     * // From a Uint8Array (zero-copy for ASCII):
     * const buf = new TextEncoder().encode('{"a":1}\n{"b":2}\n');
     * const items = Bun.JSONL.parse(buf);
     * // [{ a: 1 }, { b: 2 }]
     *
     * // Partial results on error after valid values:
     * const partial = Bun.JSONL.parse('{"a":1}\n{bad}\n');
     * // [{ a: 1 }]
     *
     * // Throws when no valid values precede the error:
     * Bun.JSONL.parse('{bad}\n'); // throws SyntaxError
     * ```
     */
    export function parse(input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike): unknown[];

    /**
     * Parse a JSONL chunk, designed for streaming use.
     *
     * Never throws on parse errors. Instead, returns whatever values were
     * successfully parsed along with an `error` property containing the
     * `SyntaxError` (or `null` on success). Use `read` to determine how
     * much input was consumed and `done` to check if all input was parsed.
     *
     * When a `TypedArray` is passed, the bytes are parsed directly without
     * copying if the content is ASCII. Optional `start` and `end` parameters
     * select a window of the input without copying. For typed arrays these
     * are byte offsets and `read` is a byte offset into the original
     * typed array. For strings these are character offsets and `read` is
     * a character offset into the original string.
     *
     * @param input The JSONL string or typed array to parse
     * @param start Offset to start parsing from (bytes for typed arrays, characters for strings, default: 0)
     * @param end Offset to stop parsing at (bytes for typed arrays, characters for strings, default: input length)
     * @returns An object with `values`, `read`, `done`, and `error` properties
     *
     * @example
     * ```js
     * let buffer = new Uint8Array(0);
     * for await (const chunk of stream) {
     *   buffer = Buffer.concat([buffer, chunk]);
     *   const { values, read, error } = Bun.JSONL.parseChunk(buffer);
     *   if (error) throw error;
     *   for (const value of values) handle(value);
     *   buffer = buffer.subarray(read);
     * }
     * ```
     */
    export function parseChunk(
      input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike,
      start?: number,
      end?: number,
    ): ParseChunkResult;
  }

  /**
   * YAML related APIs
   */
  namespace YAML {
    /**
     * Parse a YAML string into a JavaScript value
     *
     * @category Utilities
     *
     * @param input The YAML string to parse
     * @returns A JavaScript value
     *
     * @example
     * ```ts
     * import { YAML } from "bun";
     *
     * console.log(YAML.parse("123")) // 123
     * console.log(YAML.parse("null")) // null
     * console.log(YAML.parse("false")) // false
     * console.log(YAML.parse("abc")) // "abc"
     * console.log(YAML.parse("- abc")) // [ "abc" ]
     * console.log(YAML.parse("abc: def")) // { "abc": "def" }
     * ```
     */
    export function parse(input: string): unknown;

    /**
     * Convert a JavaScript value into a YAML string. Strings are double quoted if they contain keywords, non-printable or
     * escaped characters, or if a YAML parser would parse them as numbers. Anchors and aliases are inferred from objects, allowing cycles.
     *
     * @category Utilities
     *
     * @param input The JavaScript value to stringify.
     * @param replacer Not supported.
     * @param space A number for how many spaces each level of indentation gets, or a string used as indentation.
     *              Without this parameter, outputs flow-style (single-line) YAML.
     *              With this parameter, outputs block-style (multi-line) YAML.
     *              The number is clamped between 0 and 10, and the first 10 characters of the string are used.
     * @returns A string containing the YAML document.
     *
     * @example
     * ```ts
     * import { YAML } from "bun";
     *
     * const input = {
     *   abc: "def",
     *   num: 123
     * };
     *
     * // Without space - flow style (single-line)
     * console.log(YAML.stringify(input));
     * // {abc: def,num: 123}
     *
     * // With space - block style (multi-line)
     * console.log(YAML.stringify(input, null, 2));
     * // abc: def
     * // num: 123
     *
     * const cycle = {};
     * cycle.obj = cycle;
     * console.log(YAML.stringify(cycle, null, 2));
     * // &1
     * // obj: *1
     * ```
     */
    export function stringify(input: unknown, replacer?: undefined | null, space?: string | number): string;
  }

  /**
   * Markdown related APIs.
   *
   * Parses and renders markdown with four output modes:
   * - `html()` — render to an HTML string
   * - `ansi()` — render to an ANSI-colored string for terminals
   * - `render()` — render with custom callbacks for each element
   * - `react()` — parse to React-compatible JSX elements
   *
   * Supports GFM extensions (tables, strikethrough, task lists, autolinks) and
   * component overrides to replace default HTML tags with custom components.
   *
   * @example
   * ```tsx
   * // Render markdown to HTML
   * const html = Bun.markdown.html("# Hello **world**");
   * // "<h1>Hello <strong>world</strong></h1>\n"
   *
   * // Render with custom callbacks
   * const ansi = Bun.markdown.render("# Hello **world**", {
   *   heading: (children, { level }) => `\x1b[1m${children}\x1b[0m\n`,
   *   strong: (children) => `\x1b[1m${children}\x1b[22m`,
   *   paragraph: (children) => children + "\n",
   * });
   *
   * // Render as a React component
   * function Markdown({ text }: { text: string }) {
   *   return Bun.markdown.react(text);
   * }
   *
   * // With component overrides
   * const element = Bun.markdown.react("# Hello", { h1: MyHeadingComponent });
   * ```
   */
  namespace markdown {
    /**
     * Options for configuring the markdown parser.
     *
     * By default, GFM extensions (tables, strikethrough, task lists) are enabled.
     */
    interface Options {
      /** Enable GFM tables. Default: `true`. */
      tables?: boolean;
      /** Enable GFM strikethrough (`~~text~~`). Default: `true`. */
      strikethrough?: boolean;
      /** Enable GFM task lists (`- [x] item`). Default: `true`. */
      tasklists?: boolean;
      /** Treat soft line breaks as hard line breaks. Default: `false`. */
      hardSoftBreaks?: boolean;
      /** Enable wiki-style links (`[[target]]` or `[[target|label]]`). Default: `false`. */
      wikiLinks?: boolean;
      /** Enable underline syntax (`__text__` renders as `<u>` instead of `<strong>`). Default: `false`. */
      underline?: boolean;
      /** Enable LaTeX math (`$inline$` and `$$display$$`). Default: `false`. */
      latexMath?: boolean;
      /** Collapse whitespace in text content. Default: `false`. */
      collapseWhitespace?: boolean;
      /** Allow ATX headers without a space after `#`. Default: `false`. */
      permissiveAtxHeaders?: boolean;
      /** Disable indented code blocks. Default: `false`. */
      noIndentedCodeBlocks?: boolean;
      /** Disable HTML blocks. Default: `false`. */
      noHtmlBlocks?: boolean;
      /** Disable inline HTML spans. Default: `false`. */
      noHtmlSpans?: boolean;
      /**
       * Enable the GFM tag filter, which replaces `<` with `&lt;` for disallowed
       * HTML tags (e.g. `<script>`, `<style>`, `<iframe>`). Default: `false`.
       */
      tagFilter?: boolean;
      /**
       * Enable autolinks. Pass `true` to enable all autolink types (URL, WWW, email),
       * or an object to enable individually.
       *
       * @example
       * ```ts
       * // Enable all autolinks
       * { autolinks: true }
       * // Enable only URL and email autolinks
       * { autolinks: { url: true, email: true } }
       * ```
       */
      autolinks?: boolean | { url?: boolean; www?: boolean; email?: boolean };
      /**
       * Configure heading IDs and autolink headings. Pass `true` to enable both
       * heading IDs and autolink headings, or an object to configure individually.
       *
       * @example
       * ```ts
       * // Enable both heading IDs and autolink headings
       * { headings: true }
       * // Enable only heading IDs
       * { headings: { ids: true } }
       * ```
       */
      headings?: boolean | { ids?: boolean; autolink?: boolean };
    }

    /** A component that accepts props `P`: a function, class, or HTML tag name. */
    type Component<P = {}> = string | ((props: P) => any) | (new (props: P) => any);

    interface ChildrenProps {
      children: import("./jsx.d.ts").JSX.Element[];
    }
    interface HeadingProps extends ChildrenProps {
      /** Heading ID slug. Set when `headings: { ids: true }` is enabled. */
      id?: string;
    }
    interface OrderedListProps extends ChildrenProps {
      /** The start number. */
      start: number;
    }
    interface ListItemProps extends ChildrenProps {
      /** Task list checked state. Set for `- [x]` / `- [ ]` items. */
      checked?: boolean;
    }
    interface CodeBlockProps extends ChildrenProps {
      /** The info-string language (e.g. `"js"`). */
      language?: string;
    }
    interface CellProps extends ChildrenProps {
      /** Column alignment. */
      align?: "left" | "center" | "right";
    }
    interface LinkProps extends ChildrenProps {
      /** Link URL. */
      href: string;
      /** Link title attribute. */
      title?: string;
    }
    interface ImageProps {
      /** Image URL. */
      src: string;
      /** Alt text. */
      alt?: string;
      /** Image title attribute. */
      title?: string;
    }

    /**
     * Component overrides for `react()`.
     *
     * Replace default HTML tags with custom React components. Each override
     * receives the same props the default element would get.
     *
     * @example
     * ```tsx
     * function Code({ language, children }: { language?: string; children: React.ReactNode }) {
     *   return <pre data-language={language}><code>{children}</code></pre>;
     * }
     * Bun.markdown.react(text, { pre: Code });
     * ```
     */
    interface ComponentOverrides {
      h1?: Component<HeadingProps>;
      h2?: Component<HeadingProps>;
      h3?: Component<HeadingProps>;
      h4?: Component<HeadingProps>;
      h5?: Component<HeadingProps>;
      h6?: Component<HeadingProps>;
      p?: Component<ChildrenProps>;
      blockquote?: Component<ChildrenProps>;
      ul?: Component<ChildrenProps>;
      ol?: Component<OrderedListProps>;
      li?: Component<ListItemProps>;
      pre?: Component<CodeBlockProps>;
      hr?: Component<{}>;
      html?: Component<ChildrenProps>;
      table?: Component<ChildrenProps>;
      thead?: Component<ChildrenProps>;
      tbody?: Component<ChildrenProps>;
      tr?: Component<ChildrenProps>;
      th?: Component<CellProps>;
      td?: Component<CellProps>;
      em?: Component<ChildrenProps>;
      strong?: Component<ChildrenProps>;
      a?: Component<LinkProps>;
      img?: Component<ImageProps>;
      code?: Component<ChildrenProps>;
      del?: Component<ChildrenProps>;
      math?: Component<ChildrenProps>;
      u?: Component<ChildrenProps>;
      br?: Component<{}>;
    }

    /** Meta passed to the `heading` callback. */
    interface HeadingMeta {
      /** Heading level (1–6). */
      level: number;
      /** Heading ID slug. Set when `headings: { ids: true }` is enabled. */
      id?: string;
    }

    /** Meta passed to the `code` callback. */
    interface CodeBlockMeta {
      /** The info-string language (e.g. `"js"`). */
      language?: string;
    }

    /** Meta passed to the `list` callback. */
    interface ListMeta {
      /** Whether this is an ordered list. */
      ordered: boolean;
      /** The start number for ordered lists. */
      start?: number;
      /** Nesting depth. `0` for a top-level list, `1` for a list inside a list item, etc. */
      depth: number;
    }

    /** Meta passed to the `listItem` callback. */
    interface ListItemMeta {
      /** 0-based index of this item within its parent list. */
      index: number;
      /** Nesting depth of the parent list. `0` for items in a top-level list. */
      depth: number;
      /** Whether the parent list is ordered. */
      ordered: boolean;
      /** The start number of the parent list (only set when `ordered` is true). */
      start?: number;
      /** Task list checked state. Set for `- [x]` / `- [ ]` items. */
      checked?: boolean;
    }

    /** Meta passed to `th` and `td` callbacks. */
    interface CellMeta {
      /** Column alignment. */
      align?: "left" | "center" | "right";
    }

    /** Meta passed to the `link` callback. */
    interface LinkMeta {
      /** Link URL. */
      href: string;
      /** Link title attribute. */
      title?: string;
    }

    /** Meta passed to the `image` callback. */
    interface ImageMeta {
      /** Image URL. */
      src: string;
      /** Image title attribute. */
      title?: string;
    }

    /**
     * Callbacks for `render()`. Each callback receives the accumulated children
     * as a string and optional metadata, and returns a string.
     *
     * Return `null` or `undefined` to omit the element from the output.
     * If no callback is registered for an element, its children pass through unchanged.
     */
    interface RenderCallbacks {
      /** Heading (level 1–6). `id` is set when `headings: { ids: true }` is enabled. */
      heading?: (children: string, meta: HeadingMeta) => string | null | undefined;
      /** Paragraph. */
      paragraph?: (children: string) => string | null | undefined;
      /** Blockquote. */
      blockquote?: (children: string) => string | null | undefined;
      /** Code block. `meta.language` is the info-string (e.g. `"js"`). Only passed for fenced code blocks with a language. */
      code?: (children: string, meta?: CodeBlockMeta) => string | null | undefined;
      /** Ordered or unordered list. `start` is the first item number for ordered lists. */
      list?: (children: string, meta: ListMeta) => string | null | undefined;
      /** List item. `meta` always includes `{index, depth, ordered}`. `meta.start` is set for ordered lists; `meta.checked` is set for task list items. */
      listItem?: (children: string, meta: ListItemMeta) => string | null | undefined;
      /** Horizontal rule. */
      hr?: (children: string) => string | null | undefined;
      /** Table. */
      table?: (children: string) => string | null | undefined;
      /** Table head. */
      thead?: (children: string) => string | null | undefined;
      /** Table body. */
      tbody?: (children: string) => string | null | undefined;
      /** Table row. */
      tr?: (children: string) => string | null | undefined;
      /** Table header cell. `meta.align` is set when column alignment is specified. */
      th?: (children: string, meta?: CellMeta) => string | null | undefined;
      /** Table data cell. `meta.align` is set when column alignment is specified. */
      td?: (children: string, meta?: CellMeta) => string | null | undefined;
      /** Raw HTML content. */
      html?: (children: string) => string | null | undefined;
      /** Strong emphasis (`**text**`). */
      strong?: (children: string) => string | null | undefined;
      /** Emphasis (`*text*`). */
      emphasis?: (children: string) => string | null | undefined;
      /** Link. `href` is the URL, `title` is the optional title attribute. */
      link?: (children: string, meta: LinkMeta) => string | null | undefined;
      /** Image. `src` is the URL, `title` is the optional title attribute. */
      image?: (children: string, meta: ImageMeta) => string | null | undefined;
      /** Inline code (`` `code` ``). */
      codespan?: (children: string) => string | null | undefined;
      /** Strikethrough (`~~text~~`). */
      strikethrough?: (children: string) => string | null | undefined;
      /** Plain text content. */
      text?: (text: string) => string | null | undefined;
    }

    /** Options for `react()` — parser options and element symbol configuration. */
    interface ReactOptions extends Options {
      /**
       * Which `$$typeof` symbol to use on the generated elements.
       * - `19` (default): `Symbol.for('react.transitional.element')`
       * - `18`: `Symbol.for('react.element')` — use this for React 18 and older
       */
      reactVersion?: 18 | 19;
    }

    /**
     * Render markdown to an HTML string.
     *
     * @param input The markdown string or buffer to render
     * @param options Parser options
     * @returns An HTML string
     *
     * @example
     * ```ts
     * const html = Bun.markdown.html("# Hello **world**");
     * // "<h1>Hello <strong>world</strong></h1>\n"
     *
     * // With options
     * const html = Bun.markdown.html("## Hello", { headings: { ids: true } });
     * // '<h2 id="hello">Hello</h2>\n'
     * ```
     */
    export function html(
      input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike,
      options?: Options,
    ): string;

    /**
     * Theme for ANSI terminal rendering.
     */
    export interface AnsiTheme {
      /**
       * Emit ANSI color + styling escape sequences. When `false`, the
       * renderer falls back to plain ASCII chrome (no box drawing,
       * no emoji, no escape codes).
       * @default true
       */
      colors?: boolean;
      /**
       * Emit OSC 8 hyperlinks (clickable links in modern terminals).
       * When `false`, links render as `text (url)`.
       * @default false
       */
      hyperlinks?: boolean;
      /**
       * True when the terminal background is light. Affects the color
       * palette chosen for inline code backgrounds. Defaults to
       * detecting from the `COLORFGBG` environment variable.
       */
      light?: boolean;
      /**
       * Line width used for word-wrapping paragraphs and headings and
       * for the horizontal rule. Pass `0` to disable wrapping.
       * @default 80
       */
      columns?: number;
      /**
       * Inline images using the Kitty Graphics Protocol when the `src`
       * resolves to a local file on disk. Falls through to the text alt
       * for remote URLs. Supported by Kitty, WezTerm, and Ghostty.
       * @default false
       */
      kittyGraphics?: boolean;
    }

    /**
     * Render markdown to an ANSI-colored terminal string.
     *
     * Supports headings, lists, tables, inline styles, syntax-highlighted
     * code blocks, links, images, and blockquotes. By default, enables all
     * GFM extensions plus wikilinks, underline, and LaTeX math.
     *
     * @param input The markdown string or buffer to render
     * @param theme Optional theme overrides
     * @returns An ANSI-colored string
     *
     * @example
     * ```ts
     * const out = Bun.markdown.ansi("# Hello\n\n**bold** and *italic*\n");
     * process.stdout.write(out);
     *
     * // Plain text, no escape codes
     * const plain = Bun.markdown.ansi("# Hello", { colors: false });
     *
     * // Enable clickable OSC 8 hyperlinks
     * const linked = Bun.markdown.ansi("[docs](https://bun.com)", {
     *   hyperlinks: true,
     * });
     *
     * // Inline images via Kitty Graphics Protocol
     * const withImg = Bun.markdown.ansi("![alt](./logo.png)", {
     *   kittyGraphics: true,
     * });
     *
     * // Custom width
     * const wrapped = Bun.markdown.ansi(longText, { columns: 60 });
     * ```
     */
    export function ansi(
      input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike,
      theme?: AnsiTheme,
    ): string;

    /**
     * Render markdown with custom JavaScript callbacks for each element.
     *
     * Each callback receives the accumulated children as a string and optional
     * metadata, and returns a string. Return `null` or `undefined` to omit
     * an element. If no callback is registered, children pass through unchanged.
     *
     * Parser options are passed as a separate third argument.
     *
     * @param input The markdown string to render
     * @param callbacks Callbacks for each element type
     * @param options Parser options
     * @returns The accumulated string output
     *
     * @example
     * ```ts
     * // Custom HTML with classes
     * const html = Bun.markdown.render("# Title\n\nHello **world**", {
     *   heading: (children, { level }) => `<h${level} class="title">${children}</h${level}>`,
     *   paragraph: (children) => `<p>${children}</p>`,
     *   strong: (children) => `<b>${children}</b>`,
     * });
     *
     * // ANSI terminal output
     * const ansi = Bun.markdown.render("# Hello\n\n**bold**", {
     *   heading: (children) => `\x1b[1;4m${children}\x1b[0m\n`,
     *   paragraph: (children) => children + "\n",
     *   strong: (children) => `\x1b[1m${children}\x1b[22m`,
     * });
     *
     * // With parser options as third argument
     * const text = Bun.markdown.render("Visit www.example.com", {
     *   link: (children, { href }) => `[${children}](${href})`,
     *   paragraph: (children) => children,
     * }, { autolinks: true });
     * ```
     */
    export function render(
      input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike,
      callbacks?: RenderCallbacks,
      options?: Options,
    ): string;

    /**
     * Render markdown to React JSX elements.
     *
     * Returns a React Fragment containing the parsed markdown as children.
     * Can be returned directly from a component or passed to `renderToString()`.
     *
     * Override any HTML element with a custom component by passing it in the
     * second argument, keyed by tag name. Custom components receive the same props
     * the default elements would (e.g. `href` for links, `language` for code blocks).
     *
     * Parser options (including `reactVersion`) are passed as a separate third argument.
     * Uses `Symbol.for('react.transitional.element')` by default (React 19).
     * Pass `reactVersion: 18` for React 18 and older.
     *
     * @param input The markdown string or buffer to parse
     * @param components Component overrides keyed by HTML tag name
     * @param options Parser options and element symbol configuration
     * @returns A React Fragment element containing the parsed markdown
     *
     * @example
     * ```tsx
     * // Use directly as a component return value
     * function Markdown({ text }: { text: string }) {
     *   return Bun.markdown.react(text);
     * }
     *
     * // Server-side rendering
     * import { renderToString } from "react-dom/server";
     * const html = renderToString(Bun.markdown.react("# Hello **world**"));
     *
     * // Custom components receive element props
     * function Code({ language, children }: { language?: string; children: React.ReactNode }) {
     *   return <pre data-language={language}><code>{children}</code></pre>;
     * }
     * function Link({ href, children }: { href: string; children: React.ReactNode }) {
     *   return <a href={href} target="_blank">{children}</a>;
     * }
     * const el = Bun.markdown.react(text, { pre: Code, a: Link });
     *
     * // For React 18 and older
     * const el18 = Bun.markdown.react(text, undefined, { reactVersion: 18 });
     * ```
     */
    export function react(
      input: string | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike,
      components?: ComponentOverrides,
      options?: ReactOptions,
    ): import("./jsx.d.ts").JSX.Element;
  }

  /**
   * JSON5 related APIs
   */
  namespace JSON5 {
    /**
     * Parse a JSON5 string into a JavaScript value.
     *
     * JSON5 is a superset of JSON based on ECMAScript 5.1 that supports
     * comments, trailing commas, unquoted keys, single-quoted strings,
     * hex numbers, `Infinity`, `NaN`, and more.
     *
     * @category Utilities
     *
     * @param input The JSON5 string to parse
     * @returns A JavaScript value
     *
     * @example
     * ```ts
     * import { JSON5 } from "bun";
     *
     * const result = JSON5.parse(`{
     *   // This is a comment
     *   name: 'my-app',
     *   version: '1.0.0', // trailing comma is allowed
     *   hex: 0xDEADbeef,
     *   half: .5,
     *   infinity: Infinity,
     * }`);
     * ```
     */
    export function parse(input: string): unknown;

    /**
     * Convert a JavaScript value into a JSON5 string. Object keys that are
     * valid identifiers are unquoted, strings use double quotes, `Infinity`
     * and `NaN` are represented as literals, and indented output includes
     * trailing commas.
     *
     * @category Utilities
     *
     * @param input The JavaScript value to stringify.
     * @param replacer Not supported.
     * @param space A number for how many spaces each level of indentation gets, or a string used as indentation.
     *              The number is clamped between 0 and 10, and the first 10 characters of the string are used.
     * @returns A JSON5 string, or `undefined` if the input is `undefined`, a function, or a symbol.
     *
     * @example
     * ```ts
     * import { JSON5 } from "bun";
     *
     * console.log(JSON5.stringify({ a: 1, b: "two" }));
     * // {a:1,b:"two"}
     *
     * console.log(JSON5.stringify({ a: 1, b: 2 }, null, 2));
     * // {
     * //   a: 1,
     * //   b: 2,
     * // }
     * ```
     */
    export function stringify(input: unknown, replacer?: undefined | null, space?: string | number): string | undefined;
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
   * Use {@link resolveSync} instead. This async version has no performance benefit; it exists for future-proofing.
   */
  function resolve(moduleId: string, parent: string): Promise<string>;

  /**
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file. If `destination`'s directory does not exist, it is created by default.
   *
   * @category File System
   *
   * @param destination The file or file path to write to
   * @param input The data to copy into `destination`
   * @param options Options for the write
   *
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destination: BunFile | S3File | PathLike,
    input: Blob | NodeJS.TypedArray | ArrayBufferLike | string | BlobPart[] | Archive,
    options?: {
      /**
       * If writing to a PathLike, set the permissions of the file.
       */
      mode?: number;
      /**
       * If `true`, create the parent directory if it doesn't exist.
       *
       * If `false`, the write throws an error when the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  /**
   * Persist a {@link Response} body to disk.
   *
   * @param destination The file to write to. If the file doesn't exist, it is
   * created; if it does, it is overwritten. If `input` is smaller than
   * `destination`, `destination` is truncated.
   * @param input The `Response` whose body is written
   * @param options Options for the write
   *
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destination: BunFile,
    input: Response,
    options?: {
      /**
       * If `true`, create the parent directory if it doesn't exist.
       *
       * If `false`, the write throws an error when the directory doesn't exist.
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
   * exist, it is created; if it does, it is overwritten. If `input` is
   * smaller than the existing file, the file is truncated.
   * @param input The `Response` whose body is written
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destinationPath: PathLike,
    input: Response,
    options?: {
      /**
       * If `true`, create the parent directory if it doesn't exist.
       *
       * If `false`, the write throws an error when the directory doesn't exist.
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
   * back to [`fcopyfile()`](https://www.manpagez.com/man/2/fcopyfile/).
   *
   * @param destination The file to write to. If the file doesn't exist, it is
   * created; if it does, it is overwritten. If `input` is smaller than
   * `destination`, `destination` is truncated.
   * @param input The file to copy from
   * @returns A promise that resolves with the number of bytes written.
   */

  function write(
    destination: BunFile,
    input: BunFile,
    options?: {
      /**
       * Set the file permissions of the destination when it is created or overwritten.
       *
       * Must be a valid Unix permission mode (0 to 0o777 / 511 in decimal).
       * If omitted, defaults to the system default based on umask (typically 0o644).
       *
       * @throws {RangeError} If the mode is outside the valid range (0 to 0o777).
       *
       * @example
       * ```ts
       * await Bun.write(Bun.file("./secret.txt"), Bun.file("./source.txt"), { mode: 0o600 });
       * ```
       */
      mode?: number;
      /**
       * If `true`, create the parent directory if it doesn't exist.
       *
       * If `false`, the write throws an error when the directory doesn't exist.
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
   * back to [`fcopyfile()`](https://www.manpagez.com/man/2/fcopyfile/).
   *
   * @param destinationPath The file path to write to. If the file doesn't
   * exist, it is created; if it does, it is overwritten. If `input` is
   * smaller than the existing file, the file is truncated.
   * @param input The file to copy from
   * @returns A promise that resolves with the number of bytes written.
   */
  function write(
    destinationPath: PathLike,
    input: BunFile,
    options?: {
      /**
       * Set the file permissions of the destination when it is created or overwritten.
       *
       * Must be a valid Unix permission mode (0 to 0o777 / 511 in decimal).
       * If omitted, defaults to the system default based on umask (typically 0o644).
       *
       * @throws {RangeError} If the mode is outside the valid range (0 to 0o777).
       *
       * @example
       * ```ts
       * await Bun.write("./secret.txt", Bun.file("./source.txt"), { mode: 0o600 });
       * ```
       */
      mode?: number;
      /**
       * If `true`, create the parent directory if it doesn't exist.
       *
       * If `false`, the write throws an error when the directory doesn't exist.
       *
       * @default true
       */
      createPath?: boolean;
    },
  ): Promise<number>;

  /**
   * An `Error` from a failed system call, with optional `errno`, `code`,
   * `path`, and `syscall` properties.
   */
  interface SystemError extends Error {
    errno?: number | undefined;
    code?: string | undefined;
    path?: string | undefined;
    syscall?: string | undefined;
  }

  /**
   * Concatenate an array of typed arrays into a single `ArrayBuffer`.
   *
   * About 30% faster than allocating an `ArrayBuffer` and copying each chunk
   * into it yourself: the total length is known up front, so Bun can copy into
   * uninitialized memory.
   *
   * If you want a `Uint8Array` instead, consider `Buffer.concat`.
   *
   * @param buffers An array of typed arrays to concatenate.
   * @returns An `ArrayBuffer` with the data from all the buffers.
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
  ): Uint8Array<ArrayBuffer>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors,
   * concatenating the chunks into a single {@link ArrayBuffer}.
   *
   * Each chunk must be a TypedArray or an ArrayBuffer. If you need to support
   * chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns The concatenated chunks as an `ArrayBuffer`, or a promise that resolves with one.
   */
  function readableStreamToArrayBuffer(
    stream: ReadableStream<ArrayBufferView | ArrayBufferLike>,
  ): Promise<ArrayBuffer> | ArrayBuffer;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Reads the multipart or URL-encoded form data into a {@link FormData} object.
   *
   * @param stream The stream to consume.
   * @param multipartBoundaryExcludingDashes Optional boundary to use for multipart form data. If none is provided, assumes it is a URL-encoded form.
   * @returns A promise that resolves with the data encoded into a {@link FormData} object.
   *
   * @example
   * **Multipart form data example**
   * ```ts
   * // without dashes
   * const boundary = "WebKitFormBoundary" + Math.random().toString(16).slice(2);
   *
   * const stream = getStreamFromSomewhere() // ...
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
   * @param stream The stream to consume
   * @returns The chunks as an array, or a promise that resolves with one
   */
  function readableStreamToArray<T>(stream: ReadableStream<T>): Promise<T[]> | T[];

  /**
   * Escape the following characters in a string:
   *
   * - `"` becomes `"&quot;"`
   * - `&` becomes `"&amp;"`
   * - `'` becomes `"&#x27;"`
   * - `<` becomes `"&lt;"`
   * - `>` becomes `"&gt;"`
   *
   * This function is optimized for large input. On an M1X, it processes 480 MB/s -
   * 20 GB/s, depending on how much data is being escaped and whether there is non-ASCII
   * text.
   *
   * Non-string types are converted to a string before escaping.
   *
   * @category Security
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
    /**
     * Read a promise's state without awaiting it: `"pending"`, `"fulfilled"`, or `"rejected"`.
     */
    function status<T = undefined>(promise: T | Promise<T>): "pending" | "fulfilled" | "rejected";
  }

  /**
   * Convert a {@link URL} to a filesystem path.
   *
   * @param url The URL to convert.
   * @returns A filesystem path.
   * @throws If `url` is not a valid URL.
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
       * Preallocate an internal buffer of this size.
       * This can significantly improve performance when the chunk size is small.
       */
      highWaterMark?: number;
      /**
       * On {@link ArrayBufferSink.flush}, return the written data as a `Uint8Array`.
       * Writes restart from the beginning of the buffer.
       */
      stream?: boolean;
    }): void;

    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
    /**
     * Flush the internal buffer.
     *
     * - If {@link ArrayBufferSink.start} was passed a `stream` option, this returns an `ArrayBuffer`.
     * - If it was passed a `stream` option and `asUint8Array`, this returns a `Uint8Array`.
     * - Otherwise, this returns the number of bytes written since the last flush.
     *
     * This API might change later to separate Uint8ArraySink and ArrayBufferSink.
     */
    flush(): number | Uint8Array<ArrayBuffer> | ArrayBuffer;
    end(): ArrayBuffer | Uint8Array<ArrayBuffer>;
  }

  /** DNS-related APIs */
  namespace dns {
    /**
     * Look up the IP address for a hostname
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
     * - `getaddrinfo` - Uses the POSIX standard `getaddrinfo` function. Causes performance issues under concurrent loads.
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
         * situations, but it lacks support for mDNS (`*.local`,
         * `*.localhost` domains) along with some other advanced features. If
         * you run into issues using `c-ares`, try `system`. If the
         * hostname ends with `.local` or `.localhost`, Bun automatically
         * uses `system` instead of `c-ares`.
         *
         * [`getaddrinfo`](https://man7.org/linux/man-pages/man3/getaddrinfo.3.html)
         * is the POSIX standard function for blocking DNS resolution. Bun runs
         * it in Bun's thread pool, which is limited to `cpus / 2`, so many
         * concurrent DNS lookups can pause other concurrent IO until the
         * lookups finish.
         *
         * On macOS, `"getaddrinfo"` shouldn't be necessary because
         * `"system"` uses the same API underneath (except non-blocking).
         *
         * On Windows, libuv's non-blocking DNS resolver is used by default, and
         * when specifying backends "system", "libc", or "getaddrinfo". The c-ares
         * backend isn't supported on Windows.
         */
        backend?: "libc" | "c-ares" | "system" | "getaddrinfo";
      },
    ): Promise<DNSLookup[]>;

    /**
     * **Experimental API**
     *
     * Prefetch a hostname so that later `fetch()` and `Bun.connect()` calls
     * can skip the DNS lookup.
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
   * This Blob is lazy: it does no work until you read from it.
   *
   * - `size` is not valid until the contents of the file are read at least once.
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
     * If `begin` > 0, {@link Bun.write()} is slower on macOS
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
     * If `begin` > 0, {@link Bun.write}() is slower on macOS
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

    // TODO
    // readonly readable: ReadableStream<Uint8Array>;
    // readonly writable: WritableStream<Uint8Array>;

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
     * directories. A race condition can occur where the file is deleted or
     * renamed after this is called but before you open it.
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

    /**
     * Binds the token to the requesting principal (session ID, user ID, or
     * equivalent). A token generated with a `sessionId` only verifies when the
     * same `sessionId` is supplied to `verify()`. Without it, any token issued
     * under the same secret validates for every user.
     */
    sessionId?: string;
  }

  interface CSRFVerifyOptions {
    /**
     * The secret to use for the token. If not provided, Bun generates a random default secret in memory and uses it.
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

    /**
     * The principal (session ID, user ID, or equivalent) the token must be
     * bound to. A token generated with a `sessionId` only verifies when the
     * same `sessionId` is supplied here; a token generated without one only
     * verifies when this option is omitted.
     */
    sessionId?: string;
  }

  /**
   * Generate and verify CSRF tokens
   *
   * @category Security
   */
  namespace CSRF {
    /**
     * Generate a CSRF token.
     * @param secret The secret to use for the token. If not provided, Bun generates a random default secret in memory and uses it.
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
   *   Use macros as regular imports.
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
    crc32: (data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: number) => number;
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
     *    This removes the import statement from the final output
     *    and replaces any function calls or template strings with the result returned by the macro
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
     *    Code that calls `graphql` is replaced with the result of the macro.
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
     * This does two things:
     * 1. `const` declarations to primitive types (excluding Object/Array) at the top of a scope before any `let` or `var` declarations are inlined into their usages.
     * 2. `let` and `const` declarations only used once are inlined into their usages.
     *
     * JavaScript engines typically do these optimizations internally, however
     * it might only happen much later in the compilation pipeline, after code
     * has been executed many many times.
     *
     * This typically shrinks the output size of code, but it might increase
     * it in some cases. Do your own benchmarks.
     */
    inline?: boolean;

    /**
     * @default "warn"
     */
    logLevel?: "verbose" | "debug" | "info" | "warn" | "error";

    /**
     * Enable REPL mode transforms:
     * - Wraps top-level inputs that appear to be object literals (inputs starting with '{' without trailing ';') in parentheses
     * - Hoists all declarations as var for REPL persistence across vm.runInContext calls
     * - Wraps last expression in { __proto__: null, value: expr } for result capture
     * - Wraps code in sync/async IIFE to avoid parentheses around object literals
     *
     * @default false
     */
    replMode?: boolean;
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

  namespace Build {
    type Architecture = "x64" | "arm64" | "aarch64";
    type Libc = "glibc" | "musl";
    type SIMD = "baseline" | "modern";
    type CompileTarget =
      | `bun-darwin-${Architecture}`
      | `bun-darwin-${Architecture}-${SIMD}`
      | `bun-linux-${Architecture}`
      | `bun-linux-${Architecture}-${Libc}`
      | `bun-linux-${Architecture}-${SIMD}`
      | `bun-linux-${Architecture}-${SIMD}-${Libc}`
      | `bun-windows-${Architecture}`
      | `bun-windows-x64-${SIMD}`;
  }

  /**
   * @see [Bun.build API docs](https://bun.com/docs/bundler#api)
   */
  interface BuildConfig {
    /**
     * Enable code splitting
     */
    splitting?: boolean;

    /**
     * List of entrypoints, usually file paths
     */
    entrypoints: string[];

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
    plugins?: BunPlugin[];
    // manifest?: boolean; // whether to return manifest
    external?: string[];
    /**
     * Control whether dynamic `import()`, `require()`, or `require.resolve()` specifiers (non-literal
     * arguments like `` `./locales/${lang}.json` ``) are allowed to pass through
     * to runtime without being bundled.
     *
     * - `["*"]` (default) — allow all dynamic specifiers
     * - `[]` — fail the build on any dynamic specifier
     * - `["./locales/*.json", ...]` — allow only specifiers whose static
     *   template parts match one of these glob patterns
     *
     * Add `""` to the list to allow fully opaque specifiers like `import(fn())`.
     *
     * @default ["*"]
     */
    allowUnresolved?: string[];
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
    sourcemap?: "none" | "linked" | "inline" | "external" | boolean;

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
     *   For example, `"MY_PUBLIC_*"` only includes env vars starting with "MY_PUBLIC_"
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
          keepNames?: boolean;
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

    /**
     * Whether to enable tree-shaking (removal of unreferenced top-level
     * declarations and unused exports). Defaults to `true`. Set to `false` to
     * keep dead code in the output for debugging or test fixtures.
     */
    treeShaking?: boolean;

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
     * start times, but makes the final output larger and slightly increases
     * memory usage.
     *
     * - CommonJS: works with or without `compile: true`
     * - ESM: requires `compile: true`
     *
     * Without an explicit `format`, defaults to CommonJS.
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
     * Enable feature flags for dead-code elimination via `import { feature } from "bun:bundle"`.
     *
     * When `feature("FLAG_NAME")` is called, it returns `true` if FLAG_NAME is in this array,
     * or `false` otherwise. This enables static dead-code elimination at bundle time.
     *
     * Equivalent to the CLI `--feature` flag.
     *
     * @example
     * ```ts
     * await Bun.build({
     *   entrypoints: ['./src/index.ts'],
     *   features: ['FEATURE_A', 'FEATURE_B'],
     * });
     * ```
     */
    features?: string[];

    /**
     * List of package names whose barrel files (re-export index files) should
     * be optimized. When a named import comes from one of these packages,
     * only the submodules actually used are parsed — unused re-exports are
     * skipped entirely.
     *
     * This is also enabled automatically for any package with
     * `"sideEffects": false` in its `package.json`.
     *
     * @example
     * ```ts
     * await Bun.build({
     *   entrypoints: ['./app.ts'],
     *   optimizeImports: ['antd', '@mui/material', 'lodash-es'],
     * });
     * ```
     */
    optimizeImports?: string[];

    /**
     * - When set to `true`, the returned promise rejects with an AggregateError when a build failure happens.
     * - When set to `false`, returns a {@link BuildOutput} with `{success: false}`
     *
     * @default true
     */
    throw?: boolean;

    /**
     * Custom tsconfig.json file path to use for path resolution.
     * Equivalent to `--tsconfig-override` in the CLI.
     * @example
     * ```ts
     * await Bun.build({
     *   entrypoints: ['./src/index.ts'],
     *   tsconfig: './custom-tsconfig.json'
     * });
     * ```
     */
    tsconfig?: string;

    /**
     * JSX configuration options
     */
    jsx?: {
      runtime?: "automatic" | "classic";
      importSource?: string;
      factory?: string;
      fragment?: string;
      sideEffects?: boolean;
      development?: boolean;
    };

    /**
     * Enable React Fast Refresh transform.
     *
     * This adds the necessary code transformations for React Fast Refresh (hot module
     * replacement for React components), but does not emit hot-module code itself.
     *
     * @default false
     */
    reactFastRefresh?: boolean;

    /**
     * Run the React Compiler over `.jsx`/`.tsx` source files, automatically
     * memoizing components and hooks.
     *
     * @default false
     * @experimental
     */
    reactCompiler?: boolean;

    /**
     * Output mode for the React Compiler. `"ssr"` skips memoization (the
     * `useMemoCache` runtime) for server-rendered output.
     *
     * Only applies when {@link reactCompiler} is `true`.
     *
     * @default `"client"` when {@link target} is `"browser"`; `"ssr"` when
     * {@link target} is `"bun"` or `"node"`.
     * @experimental
     */
    reactCompilerOutputMode?: "client" | "ssr";

    /**
     * A map of file paths to their contents for in-memory bundling.
     *
     * Use this to bundle virtual files that don't exist on disk, or override
     * the contents of files that do exist on disk. The keys are file paths (which should
     * match how they're imported) and the values are the file contents.
     *
     * File contents can be provided as:
     * - `string` - The source code as a string
     * - `Blob` - A Blob containing the source code
     * - `NodeJS.TypedArray` - A typed array (e.g., `Uint8Array`) containing the source code
     * - `ArrayBufferLike` - An ArrayBuffer containing the source code
     *
     * @example
     * ```ts
     * // Bundle entirely from memory (no files on disk needed)
     * await Bun.build({
     *   entrypoints: ["/app/index.ts"],
     *   files: {
     *     "/app/index.ts": `
     *       import { helper } from "./helper.ts";
     *       console.log(helper());
     *     `,
     *     "/app/helper.ts": `
     *       export function helper() {
     *         return "Hello from memory!";
     *       }
     *     `,
     *   },
     * });
     * ```
     *
     * @example
     * ```ts
     * // Override a file on disk with in-memory contents
     * await Bun.build({
     *   entrypoints: ["./src/index.ts"],
     *   files: {
     *     // This will be used instead of the actual ./src/config.ts file
     *     "./src/config.ts": `export const API_URL = "https://production.api.com";`,
     *   },
     * });
     * ```
     *
     * @example
     * ```ts
     * // Mix disk files with in-memory files
     * // Entry point is on disk, but imports a virtual file
     * await Bun.build({
     *   entrypoints: ["./src/index.ts"], // Real file on disk
     *   files: {
     *     // Virtual file that ./src/index.ts can import via "./generated.ts"
     *     "./src/generated.ts": `export const BUILD_TIME = ${Date.now()};`,
     *   },
     * });
     * ```
     */
    files?: Record<string, string | Blob | NodeJS.TypedArray | ArrayBufferLike>;

    /**
     * Generate a JSON file containing metadata about the build.
     *
     * The metafile contains information about inputs, outputs, imports, and exports
     * which can be used for bundle analysis, visualization, or integration with
     * other tools.
     *
     * When `true`, the metafile JSON string is included in the {@link BuildOutput.metafile} property.
     *
     * @default false
     *
     * @example
     * ```ts
     * const result = await Bun.build({
     *   entrypoints: ['./src/index.ts'],
     *   outdir: './dist',
     *   metafile: true,
     * });
     *
     * // Write metafile to disk for analysis
     * if (result.metafile) {
     *   await Bun.write('./dist/meta.json', result.metafile);
     * }
     *
     * // Parse and analyze the metafile
     * const meta = JSON.parse(result.metafile!);
     * console.log('Input files:', Object.keys(meta.inputs));
     * console.log('Output files:', Object.keys(meta.outputs));
     * ```
     */
    metafile?: boolean;

    outdir?: string;

    /**
     * Create a standalone executable or self-contained HTML.
     *
     * When `true`, creates an executable for the current platform.
     * When a target string, creates an executable for that platform.
     *
     * When used with `target: "browser"`, produces self-contained HTML files
     * with all scripts, styles, and assets inlined. All `<script>` tags become
     * inline `<script>` with bundled code, all `<link rel="stylesheet">` tags
     * become inline `<style>` tags, and all asset references become `data:` URIs.
     * All entrypoints must be HTML files. Cannot be used with `splitting`.
     *
     * @example
     * ```ts
     * // Create executable for current platform
     * await Bun.build({
     *   entrypoints: ['./app.js'],
     *   compile: {
     *     target: 'linux-x64',
     *   },
     *   outfile: './my-app'
     * });
     *
     * // Cross-compile for Linux x64
     * await Bun.build({
     *   entrypoints: ['./app.js'],
     *   compile: 'linux-x64',
     *   outfile: './my-app'
     * });
     *
     * // Produce self-contained HTML
     * await Bun.build({
     *   entrypoints: ['./index.html'],
     *   target: 'browser',
     *   compile: true,
     * });
     * ```
     */
    compile?: boolean | Bun.Build.CompileTarget | CompileBuildOptions;
  }

  interface CompileBuildOptions {
    target?: Bun.Build.CompileTarget;
    execArgv?: string[];
    executablePath?: string;
    outfile?: string;
    /**
     * Whether the standalone executable loads .env files when it runs
     *
     * Equivalent CLI flags: `--compile-autoload-dotenv`, `--no-compile-autoload-dotenv`
     *
     * @default true
     */
    autoloadDotenv?: boolean;
    /**
     * Whether the standalone executable loads bunfig.toml when it runs
     *
     * Equivalent CLI flags: `--compile-autoload-bunfig`, `--no-compile-autoload-bunfig`
     *
     * @default true
     */
    autoloadBunfig?: boolean;
    /**
     * Whether the standalone executable loads tsconfig.json when it runs
     *
     * Equivalent CLI flags: `--compile-autoload-tsconfig`, `--no-compile-autoload-tsconfig`
     *
     * @default false
     */
    autoloadTsconfig?: boolean;
    /**
     * Whether the standalone executable loads package.json when it runs
     *
     * Equivalent CLI flags: `--compile-autoload-package-json`, `--no-compile-autoload-package-json`
     *
     * @default false
     */
    autoloadPackageJson?: boolean;
    windows?: {
      hideConsole?: boolean;
      icon?: string;
      title?: string;
      publisher?: string;
      version?: string;
      description?: string;
      copyright?: string;
    };
  }

  /**
   * Hash and verify passwords using argon2 or bcrypt
   *
   * The asynchronous functions run in a worker thread.
   *
   * @see [Bun.password API docs](https://bun.com/guides/util/hash-a-password)
   *
   * @category Security
   */
  namespace Password {
    interface Argon2Algorithm {
      algorithm: "argon2id" | "argon2d" | "argon2i";

      /**
       * Memory usage, in kibibytes. Minimum 8.
       */
      memoryCost?: number;
      /**
       * Number of iterations. More iterations means more computation and a
       * longer hash time.
       */
      timeCost?: number;
    }

    interface BCryptAlgorithm {
      algorithm: "bcrypt";

      /**
       * A number between 4 and 31.
       *
       * @default 10
       */
      cost?: number;
    }

    type AlgorithmLabel = (BCryptAlgorithm | Argon2Algorithm)["algorithm"];
  }

  /**
   * Hash and verify passwords using argon2 or bcrypt. The default is argon2.
   * Password hashing functions are necessarily slow, so the asynchronous
   * functions run in a worker thread.
   *
   * The underlying implementation of these functions is provided by the
   * `rust-argon2` and `bcrypt` Rust crates.
   *
   * @see [Bun.password API docs](https://bun.com/guides/util/hash-a-password)
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
     * @throws If the hash is invalid
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
       * If not specified, the algorithm is inferred from the hash.
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
       * When using bcrypt, passwords longer than 72 bytes are hashed with
       * SHA-512 before being passed to bcrypt
       *
       * @default "argon2id"
       */
      algorithm?: Password.AlgorithmLabel | Password.Argon2Algorithm | Password.BCryptAlgorithm,
    ): Promise<string>;

    /**
     * Synchronously verify a password against a previously hashed password using
     * argon2 or bcrypt. The default is argon2.
     *
     * Warning: password hashing is slow. Prefer {@link Bun.password.verify},
     * which runs in a worker thread.
     *
     * The underlying implementation of these functions is provided by the
     * `rust-argon2` and `bcrypt` Rust crates.
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
       * If not specified, the algorithm is inferred from the hash.
       */
      algorithm?: Password.AlgorithmLabel,
    ): boolean;

    /**
     * Synchronously hash a password using argon2 or bcrypt. The default is argon2.
     *
     * Warning: password hashing is slow. Prefer {@link Bun.password.hash},
     * which runs in a worker thread.
     *
     * The underlying implementation of these functions is provided by the
     * `rust-argon2` and `bcrypt` Rust crates.
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
       * When using bcrypt, passwords longer than 72 bytes are hashed with
       * SHA-512 before being passed to bcrypt
       *
       * @default "argon2id"
       */
      algorithm?: Password.AlgorithmLabel | Password.Argon2Algorithm | Password.BCryptAlgorithm,
    ): string;
  };

  /**
   * Securely store and retrieve sensitive credentials using the operating system's native credential storage.
   *
   * Uses platform-specific secure storage:
   * - **macOS**: Keychain Services
   * - **Linux**: libsecret (GNOME Keyring, KWallet, and others)
   * - **Windows**: Windows Credential Manager
   *
   * @category Security
   *
   * @example
   * ```ts
   * import { secrets } from "bun";
   *
   * // Store a credential
   * await secrets.set({
   *   service: "my-cli-tool",
   *   name: "github-token",
   *   value: "ghp_xxxxxxxxxxxxxxxxxxxx"
   * });
   *
   * // Retrieve a credential
   * const token = await secrets.get({
   *   service: "my-cli-tool",
   *   name: "github-token"
   * });
   *
   * if (token) {
   *   console.log("Token found:", token);
   * } else {
   *   console.log("Token not found");
   * }
   *
   * // Delete a credential
   * const deleted = await secrets.delete({
   *   service: "my-cli-tool",
   *   name: "github-token"
   * });
   * console.log("Deleted:", deleted); // true if deleted, false if not found
   * ```
   *
   * @example
   * ```ts
   * // Replace plaintext config files
   * import { secrets } from "bun";
   *
   * // Instead of storing in ~/.npmrc
   * await secrets.set({
   *   service: "npm-registry",
   *   name: "https://registry.npmjs.org",
   *   value: "npm_xxxxxxxxxxxxxxxxxxxx"
   * });
   *
   * // Instead of storing in ~/.aws/credentials
   * await secrets.set({
   *   service: "aws-cli",
   *   name: "default",
   *   value: process.env.AWS_SECRET_ACCESS_KEY
   * });
   *
   * // Load at runtime with fallback
   * const apiKey = await secrets.get({
   *   service: "my-app",
   *   name: "api-key"
   * }) || process.env.API_KEY;
   * ```
   */
  const secrets: {
    /**
     * Retrieve a stored credential from the operating system's secure storage.
     *
     * @param options The service and name identifying the credential
     * @returns The stored credential value, or null if not found
     *
     * @example
     * ```ts
     * const password = await Bun.secrets.get({
     *   service: "my-database",
     *   name: "admin"
     * });
     *
     * if (password) {
     *   await connectToDatabase(password);
     * }
     * ```
     *
     * @example
     * ```ts
     * // Check multiple possible locations
     * const token =
     *   await Bun.secrets.get({ service: "github", name: "token" }) ||
     *   await Bun.secrets.get({ service: "gh-cli", name: "github.com" }) ||
     *   process.env.GITHUB_TOKEN;
     * ```
     */
    get(options: {
      /**
       * The service or application name.
       *
       * Use a unique identifier for your application to avoid conflicts.
       * Consider reverse domain notation for production apps, for example
       * "com.example.myapp".
       */
      service: string;

      /**
       * The account name, username, or resource identifier (such as an email
       * address or URL) that identifies the credential within the service.
       */
      name: string;
    }): Promise<string | null>;

    /**
     * Store or update a credential in the operating system's secure storage.
     *
     * If a credential already exists for the given service/name combination, it is replaced.
     * The credential is encrypted by the operating system and only accessible to the current user.
     *
     * @param options The service and name identifying the credential, and the value to store
     * @param value The secret value to store, such as a password, API key, or token
     *
     * @example
     * ```ts
     * // Store an API key
     * await Bun.secrets.set({
     *   service: "openai-api",
     *   name: "production",
     *   value: "sk-proj-xxxxxxxxxxxxxxxxxxxx"
     * });
     * ```
     *
     * @example
     * ```ts
     * // Update an existing credential
     * const newPassword = generateSecurePassword();
     * await Bun.secrets.set({
     *   service: "email-server",
     *   name: "admin@example.com",
     *   value: newPassword
     * });
     * ```
     *
     * @example
     * ```ts
     * // Store credentials from environment variables
     * if (process.env.DATABASE_PASSWORD) {
     *   await Bun.secrets.set({
     *     service: "postgres",
     *     name: "production",
     *     value: process.env.DATABASE_PASSWORD
     *   });
     *   delete process.env.DATABASE_PASSWORD; // Remove from memory
     * }
     * ```
     *
     * @example
     * ```ts
     * // Delete a credential using empty string (equivalent to delete())
     * await Bun.secrets.set({
     *   service: "my-service",
     *   name: "api-key",
     *   value: "" // Empty string deletes the credential
     * });
     * ```
     *
     * @example
     * ```ts
     * // Store credential with unrestricted access for CI environments
     * await Bun.secrets.set({
     *   service: "github-actions",
     *   name: "deploy-token",
     *   value: process.env.DEPLOY_TOKEN,
     *   allowUnrestrictedAccess: true // Allows access without user interaction on macOS
     * });
     * ```
     */
    set(options: {
      /**
       * The service or application name.
       *
       * Use a unique identifier for your application to avoid conflicts.
       * Consider reverse domain notation for production apps, for example
       * "com.example.myapp".
       */
      service: string;

      /**
       * The account name, username, or resource identifier (such as an email
       * address or URL) that identifies the credential within the service.
       */
      name: string;

      /**
       * The secret value to store, such as a password, API key, or token.
       * The operating system encrypts the value before storing it.
       *
       * An empty string deletes the credential if it exists, the same as
       * calling `delete()`.
       */
      value: string;

      /**
       * Allow unrestricted access to stored credentials on macOS.
       *
       * When true, allows all applications to access this keychain item without user interaction.
       * This is useful for CI environments but reduces security.
       *
       * @default false
       * @platform macOS - Only affects macOS keychain behavior. Ignored on other platforms.
       */
      allowUnrestrictedAccess?: boolean;
    }): Promise<void>;

    /**
     * Delete a stored credential from the operating system's secure storage.
     *
     * @param options The service and name identifying the credential
     * @returns true if a credential was deleted, false if not found
     *
     * @example
     * ```ts
     * // Delete a single credential
     * const deleted = await Bun.secrets.delete({
     *   service: "my-app",
     *   name: "api-key"
     * });
     *
     * if (deleted) {
     *   console.log("Credential removed successfully");
     * } else {
     *   console.log("Credential was not found");
     * }
     * ```
     *
     * @example
     * ```ts
     * // Clean up multiple credentials
     * const services = ["github", "npm", "docker"];
     * for (const service of services) {
     *   await Bun.secrets.delete({
     *     service,
     *     name: "token"
     *   });
     * }
     * ```
     *
     * @example
     * ```ts
     * // Clean up on uninstall
     * if (process.argv.includes("--uninstall")) {
     *   const deleted = await Bun.secrets.delete({
     *     service: "my-cli-tool",
     *     name: "config"
     *   });
     *   process.exit(deleted ? 0 : 1);
     * }
     * ```
     */
    delete(options: {
      /**
       * The service or application name.
       *
       * Use a unique identifier for your application to avoid conflicts.
       * Consider reverse domain notation for production apps, for example
       * "com.example.myapp".
       */
      service: string;

      /**
       * The account name, username, or resource identifier (such as an email
       * address or URL) that identifies the credential within the service.
       */
      name: string;
    }): Promise<boolean>;
  };

  /**
   * A file generated by the bundler.
   *
   * @see {@link Bun.build}
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
    /**
     * Metadata about the build:
     * - **inputs**: every bundled source file with its byte size, imports, and format
     * - **outputs**: every generated file with its byte size, the inputs that
     *   contributed to it, imports between chunks, and exports
     *
     * Only present when {@link BuildConfig.metafile} is `true`.
     *
     * Use it for bundle size analysis, inspecting the dependency graph, or as
     * input to bundle analyzer tools.
     *
     * @example
     * ```ts
     * const result = await Bun.build({
     *   entrypoints: ['./src/index.ts'],
     *   outdir: './dist',
     *   metafile: true,
     * });
     *
     * if (result.metafile) {
     *   // Analyze input files
     *   for (const [path, input] of Object.entries(result.metafile.inputs)) {
     *     console.log(`${path}: ${input.bytes} bytes, ${input.imports.length} imports`);
     *   }
     *
     *   // Analyze output files
     *   for (const [path, output] of Object.entries(result.metafile.outputs)) {
     *     console.log(`${path}: ${output.bytes} bytes`);
     *     for (const [inputPath, info] of Object.entries(output.inputs)) {
     *       console.log(`  - ${inputPath}: ${info.bytesInOutput} bytes`);
     *     }
     *   }
     *
     *   // Write to disk for external analysis tools
     *   await Bun.write('./dist/meta.json', JSON.stringify(result.metafile));
     * }
     * ```
     */
    metafile?: BuildMetafile;
  }

  /**
   * Build metadata: every input and output file, its size, and the imports
   * between them.
   *
   * @see {@link BuildOutput.metafile}
   *
   * @category Bundler
   */
  interface BuildMetafile {
    /** Input source files, keyed by path */
    inputs: {
      [path: string]: {
        /** Size of the input file in bytes */
        bytes: number;
        /** List of imports from this file */
        imports: Array<{
          /** Resolved path of the imported file */
          path: string;
          /** Type of import statement */
          kind: ImportKind;
          /** Original import specifier before resolution (if different from path) */
          original?: string;
          /** Whether this import is external to the bundle */
          external?: boolean;
          /** Import attributes, for example `{ type: "json" }` */
          with?: Record<string, string>;
        }>;
        /** Module format of the input file */
        format?: "esm" | "cjs" | "json" | "css";
      };
    };
    /** Output files, keyed by path */
    outputs: {
      [path: string]: {
        /** Size of the output file in bytes */
        bytes: number;
        /** Map of input files to their contribution in this output */
        inputs: {
          [path: string]: {
            /** Number of bytes this input contributed to the output */
            bytesInOutput: number;
          };
        };
        /** List of imports to other chunks */
        imports: Array<{
          /** Path to the imported chunk */
          path: string;
          /** Type of import */
          kind: ImportKind;
        }>;
        /** List of exported names from this output */
        exports: string[];
        /** Entrypoint path, if this output is an entrypoint */
        entryPoint?: string;
        /** Path to the associated CSS bundle (for JS entrypoints with CSS) */
        cssBundle?: string;
      };
    };
  }

  /**
   * Bundles JavaScript, TypeScript, CSS, HTML and other supported files into optimized outputs.
   *
   * @param config Build configuration options
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
   * Handle build errors with position info
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
     * File path to a `.pem` file containing custom Diffie-Hellman parameters
     */
    dhParamsFile?: string;

    /**
     * Explicitly set a server name
     */
    serverName?: string;

    /**
     * Sets `OPENSSL_RELEASE_BUFFERS` to 1.
     * Reduces overall performance but saves some memory.
     * @default false
     */
    lowMemoryMode?: boolean;

    /**
     * If set to `false`, any certificate is accepted.
     * Default is `$NODE_TLS_REJECT_UNAUTHORIZED` environment variable, or `true` if it is not set.
     */
    rejectUnauthorized?: boolean;

    /**
     * If set to `true`, the server requests a client certificate.
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
     *  intermediate certificates are not provided, the peer cannot
     *  validate the certificate, and the handshake fails.
     */
    cert?: string | BufferSource | BunFile | Array<string | BufferSource | BunFile> | undefined;
    /**
     * Private keys in PEM format. PEM allows the option of private keys
     * being encrypted. Encrypted keys are decrypted with
     * options.passphrase. Multiple keys using different algorithms can be
     * provided either as an array of unencrypted key strings or buffers,
     * or an array of objects in the form {pem: <string|buffer>[,
     * passphrase: <string>]}. The object form can only occur in an array.
     * object.passphrase is optional. Encrypted keys are decrypted with
     * object.passphrase if provided, or options.passphrase if it is not.
     */
    key?: string | BufferSource | BunFile | Array<string | BufferSource | BunFile> | undefined;
    /**
     * Optionally affect the OpenSSL protocol behavior, which is not
     * usually necessary. Use it carefully, if at all. Value is a numeric
     * bitmask of the SSL_OP_* options from OpenSSL Options
     */
    secureOptions?: number | undefined; // Value is a numeric bitmask of the `SSL_OP_*` options

    ALPNProtocols?: string | BufferSource;

    ciphers?: string;

    clientRenegotiationLimit?: number;

    clientRenegotiationWindow?: number;
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
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy: it does no work until you read from it.
   *
   * - `size` is not valid until the contents of the file are read at least once.
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
   * @param path The path to the file (lazily loaded). If the path starts with `s3://`, the file behaves like {@link S3File}
   */
  function file(path: string | URL, options?: BlobPropertyBag): BunFile;

  /**
   * A list of files embedded into the standalone executable, lexicographically sorted by name.
   *
   * If the process is not a standalone executable, this array is empty.
   */
  const embeddedFiles: ReadonlyArray<Blob>;

  /**
   * `true` when the current process is a standalone executable produced by
   * `bun build --compile`, `false` otherwise.
   *
   * Unlike checking `Bun.embeddedFiles.length > 0`, reading this property does
   * not materialize embedded files as `Blob` objects.
   *
   * @example
   * ```ts
   * if (Bun.isStandaloneExecutable) {
   *   console.log("Running from a compiled binary");
   * }
   * ```
   */
  const isStandaloneExecutable: boolean;

  /**
   * `Blob` that uses the fastest system calls available to operate on files.
   *
   * This Blob is lazy: it does no work until you read from it. Errors propagate as promise rejections.
   *
   * `Blob.size` is not valid until the contents of the file are read at least once.
   * `Blob.type` is set based on the file extension when possible
   *
   * @example
   * ```js
   * const file = Bun.file(new TextEncoder().encode("./hello.json"));
   * console.log(file.type); // "application/json"
   * ```
   *
   * @param path The path to the file as a byte buffer (the buffer is copied). If the path starts with `s3://`, the file behaves like {@link S3File}
   */
  function file(path: ArrayBufferLike | Uint8Array<ArrayBuffer>, options?: BlobPropertyBag): BunFile;

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy: it does no work until you read from it.
   *
   * - `size` is not valid until the contents of the file are read at least once.
   *
   * @example
   * ```js
   * const file = Bun.file(fd);
   * ```
   *
   * @param fileDescriptor An open file descriptor
   */
  function file(fileDescriptor: number, options?: BlobPropertyBag): BunFile;

  /**
   * Allocate a new [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) without zeroing the bytes.
   *
   * This can be 3.5x faster than `new Uint8Array(size)`, but if you send uninitialized memory to your users (even unintentionally), it can leak anything recently in memory.
   */
  function allocUnsafe(size: number): Uint8Array<ArrayBuffer>;

  /**
   * Options for `Bun.inspect`
   */
  interface BunInspectOptions {
    /**
     * Whether to colorize the output
     */
    colors?: boolean;
    /**
     * The depth of the inspection. Pass `null` or `Infinity` for unlimited depth.
     */
    depth?: number | null;
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
     * Options for the TLS connection.
     *
     * Supports full TLS configuration including custom CA certificates,
     * client certificates, and other TLS settings (same as fetch).
     *
     * @example
     * ```ts
     * // Using BunFile for certificates
     * const ws = new WebSocket("wss://example.com", {
     *   tls: {
     *     ca: Bun.file("./ca.pem")
     *   }
     * });
     *
     * // Using Buffer
     * const ws = new WebSocket("wss://example.com", {
     *   tls: {
     *     ca: fs.readFileSync("./ca.pem")
     *   }
     * });
     * ```
     */
    tls?: TLSOptions;
  };

  type WebSocketOptionsHeaders = {
    /**
     * Headers to send to the server
     */
    headers?: import("node:http").OutgoingHttpHeaders;
  };

  type WebSocketOptionsProxy = {
    /**
     * HTTP proxy to use for the WebSocket connection.
     *
     * Can be a string URL, a URL instance, or an object with `url` and
     * optional `headers`.
     *
     * @example
     * ```ts
     * // String format
     * const ws = new WebSocket("wss://example.com", {
     *   proxy: "http://proxy.example.com:8080"
     * });
     *
     * // With credentials
     * const ws = new WebSocket("wss://example.com", {
     *   proxy: "http://user:pass@proxy.example.com:8080"
     * });
     *
     * // Object format with custom headers
     * const ws = new WebSocket("wss://example.com", {
     *   proxy: {
     *     url: "http://proxy.example.com:8080",
     *     headers: {
     *       "Proxy-Authorization": "Bearer token"
     *     }
     *   }
     * });
     * ```
     */
    proxy?:
      | string
      | URL
      | {
          /**
           * The proxy URL (http:// or https://), as a string or a `URL`.
           */
          url: string | URL;
          /**
           * Custom headers to send to the proxy server.
           * Supports plain objects or Headers class instances.
           */
          headers?: import("node:http").OutgoingHttpHeaders | Headers;
        };
  };

  type WebSocketOptionsCompression = {
    /**
     * Whether to offer the `permessage-deflate` extension in the WebSocket
     * upgrade request. Pass `false` to suppress the `Sec-WebSocket-Extensions`
     * header entirely — matching the `ws` package's `perMessageDeflate: false`
     * option.
     *
     * Defaults to `true` (the upgrade request advertises
     * `permessage-deflate; client_max_window_bits`). Any falsy value
     * (`false`, `null`, `0`, `""`, explicit `undefined`) disables the offer.
     *
     * @default true
     */
    perMessageDeflate?: boolean;
  };

  /**
   * Constructor options for the `Bun.WebSocket` client
   */
  type WebSocketOptions = WebSocketOptionsProtocolsOrProtocol &
    WebSocketOptionsTLS &
    WebSocketOptionsHeaders &
    WebSocketOptionsProxy &
    WebSocketOptionsCompression;

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
     * @param code A close code an endpoint is allowed to send (RFC 6455): `1000`-`1014` except
     * the reserved `1004`-`1006`, or `3000`-`4999`. Any other code throws an `InvalidAccessError`.
     * @param reason A human-readable string explaining why the connection is closing. Throws a
     * `SyntaxError` if longer than 123 bytes of UTF-8
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
   * Pretty-prints an object to a `string`, the same as {@link console.log}
   *
   * Supports JSX
   *
   * @param arg The value to inspect
   * @param options Options for the inspection
   */
  function inspect(arg: any, options?: BunInspectOptions): string;
  namespace inspect {
    /**
     * Symbol for declaring a custom inspect function on an object. Same as `util.inspect.custom` in Node.js.
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
     * Whether other processes see writes immediately.
     * `true` maps with MAP_SHARED; `false` maps with MAP_PRIVATE.
     * @default true
     */
    shared?: boolean;
    /**
     * Byte offset into the file where the mapping starts.
     * @default 0
     */
    offset?: number;
    /**
     * Maximum number of bytes to map. Clamped to the file size
     * (minus `offset`). Defaults to mapping the rest of the file.
     */
    size?: number;
  }
  /**
   * Open a file as a live-updating `Uint8Array` without copying memory
   * - Writing to the array writes to the file.
   * - Reading from the array reads from the file.
   *
   * This uses the [`mmap()`](https://man7.org/linux/man-pages/man2/mmap.2.html) syscall.
   *
   * ---
   *
   * This API inherently has some rough edges:
   * - It does not support empty files. It throws a `SystemError` with `EINVAL`
   * - Usage on shared/networked filesystems is discouraged. It is very slow.
   * - Deleting or truncating the file crashes Bun with a segmentation fault.
   *
   * ---
   *
   * To close the file, set the array to `null`; it is garbage collected eventually.
   */
  function mmap(path: PathLike, opts?: MMapOptions): Uint8Array<ArrayBuffer>;

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
    | Uint8Array<ArrayBuffer>
    | Uint8ClampedArray<ArrayBuffer>
    | Float32Array
    | Float64Array
    | string
    | number
    | { toString(): string };

  /**
   * Converts a color to a different format
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
       * @example hsl(35.764706, 100%, 50%)
       */
      | "hsl"
      /**
       * @example lab(72.732764% 33.938198 -25.311619)
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
   * @param outputFormat Specify `[rgb]` to output as a `[r, g, b]` array
   */
  function color(input: ColorInput, outputFormat: "[rgb]"): [number, number, number] | null;
  /**
   * Convert any color input to rgba
   * @param input Any color input
   * @param outputFormat Specify `[rgba]` to output as a `[r, g, b, a]` array
   */
  function color(input: ColorInput, outputFormat: "[rgba]"): [number, number, number, number] | null;
  /**
   * Convert any color input to rgb
   * @param input Any color input
   * @param outputFormat Specify `{rgb}` to output as an object with `r`, `g`, and `b` properties
   */
  function color(input: ColorInput, outputFormat: "{rgb}"): { r: number; g: number; b: number } | null;
  /**
   * Convert any color input to rgba
   * @param input Any color input
   * @param outputFormat Specify `{rgba}` to output as an object with `r`, `g`, `b`, and `a` properties
   */
  function color(input: ColorInput, outputFormat: "{rgba}"): { r: number; g: number; b: number; a: number } | null;
  /**
   * Convert any color input to a number
   * @param input Any color input
   * @param outputFormat Specify `number` to output as a number
   */
  function color(input: ColorInput, outputFormat: "number"): number | null;

  /**
   * Bun.semver parses and compares version numbers.
   */
  namespace semver {
    /**
     * Tests whether `version` satisfies `range`. Both arguments are stringified first.
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
     * **Only use this for ASCII strings**. If there are non-ASCII characters, your application may crash or hit confusing bugs such as `"foo" !== "foo"`.
     *
     * **The input buffer must not be garbage collected**. Hold a reference to it for the lifetime of the string.
     */
    function arrayBufferToString(buffer: Uint8Array<ArrayBuffer> | ArrayBufferLike): string;

    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint16Array`
     *
     * **The input must be a UTF-16 encoded string**. This API does no validation whatsoever.
     *
     * **The input buffer must not be garbage collected**. Hold a reference to it for the lifetime of the string.
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
     * @param level The level to set: `0`, `1`, or `2`
     * @returns The previous level
     */
    function gcAggressionLevel(level?: 0 | 1 | 2): 0 | 1 | 2;

    /**
     * Dump the mimalloc heap to the console
     */
    function mimallocDump(): void;

    /**
     * Accurate per-process memory footprint in bytes.
     *
     * Unlike `process.memoryUsage.rss()`, this excludes pages already
     * returned to the OS that the kernel keeps mapped lazily (Darwin's
     * `MADV_FREE_REUSABLE`), so leak tests are platform-comparable.
     *
     * Backed by `task_info(TASK_VM_INFO).phys_footprint` on Darwin, `Pss:`
     * from `/proc/self/smaps_rollup` on Linux, and `PrivateUsage` on Windows.
     * Returns `undefined` on platforms with no accurate accessor; callers
     * should fall back: `Bun.unsafe.memoryFootprint() ?? process.memoryUsage.rss()`.
     */
    function memoryFootprint(): number | undefined;
  }

  type DigestEncoding = "utf8" | "ucs2" | "utf16le" | "latin1" | "ascii" | "base64" | "base64url" | "hex";

  /**
   * Whether ANSI colors are enabled for stdin and stdout
   *
   * Used for {@link console.log}
   */
  const enableANSIColors: boolean;

  /**
   * Absolute path of the script that launched Bun
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
   * JavaScriptCore engine's internal heap snapshot format
   *
   * For a snapshot Chrome DevTools can read, use {@link generateHeapSnapshot} with the `"v8"` format.
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
   * Returns the number of nanoseconds since the process was started, measured with a
   * high-resolution monotonic system timer.
   *
   * JavaScript numbers are IEEE 754 doubles, which represent integers exactly only up to
   * 2^53 - 1 (`Number.MAX_SAFE_INTEGER`). After about 14.8 weeks of uptime the nanosecond
   * count exceeds that, so the returned value keeps counting but loses precision.
   *
   * @returns Nanoseconds since the process started
   */
  function nanoseconds(): number;

  /**
   * Generates a heap snapshot in JavaScriptCore's format. View it with `bun --inspect` or
   * Safari's Web Inspector
   */
  function generateHeapSnapshot(format?: "jsc"): HeapSnapshot;

  /**
   * Generates a V8 heap snapshot for use with Chrome DevTools or Visual Studio Code
   *
   * Returns a JSON string you can save to a file.
   *
   * @example
   * ```ts
   * const snapshot = Bun.generateHeapSnapshot("v8");
   * await Bun.write("heap.heapsnapshot", snapshot);
   * ```
   */
  function generateHeapSnapshot(format: "v8"): string;

  /**
   * Generates a V8 heap snapshot as an `ArrayBuffer` containing the UTF-8 encoded JSON.
   *
   * This avoids the overhead of creating a JavaScript string for large heap snapshots.
   *
   * @example
   * ```ts
   * const snapshot = Bun.generateHeapSnapshot("v8", "arraybuffer");
   * await Bun.write("heap.heapsnapshot", snapshot);
   * ```
   */
  function generateHeapSnapshot(format: "v8", encoding: "arraybuffer"): ArrayBuffer;

  /**
   * The next time JavaScriptCore is idle, clear unused memory and attempt to reduce the heap size.
   *
   * @deprecated
   */
  function shrink(): void;

  /**
   * Open a file in your local editor. The editor is detected from `$VISUAL` or `$EDITOR`
   *
   * @param path Path of the file to open
   * @param options Editor, line, and column overrides
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
     * @param data Data to add to the hash
     */
    update(data: Bun.BlobOrStringOrBuffer): T;

    /**
     * Finalize the hash
     *
     * @param encoding `DigestEncoding` to return the hash in. If none is provided, the hash is returned as a `Uint8Array`
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
    | "blake2s256"
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
     * @param hmacKey Optional key for HMAC. If not provided, the hasher is a regular (non-HMAC) hasher.
     */
    constructor(algorithm: SupportedCryptoAlgorithms, hmacKey?: string | NodeJS.TypedArray);

    /**
     * Update the hash with data
     *
     * @param input Data to add to the hash. `Uint8Array` or `ArrayBuffer` is faster than a string
     */
    update(input: Bun.BlobOrStringOrBuffer, inputEncoding?: import("crypto").Encoding): CryptoHasher;

    /**
     * Perform a deep copy of the hasher
     */
    copy(): CryptoHasher;

    /**
     * Finalize the hash. Resets the CryptoHasher so it can be reused.
     *
     * @param encoding `DigestEncoding` to return the hash in
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
   * Returns a `Promise` that resolves after the given number of milliseconds,
   * or at the given {@link Date}. Like {@link setTimeout}, except it returns a
   * `Promise`.
   *
   * @category Utilities
   *
   * @param ms milliseconds to wait before resolving the promise. This is a
   * minimum; it may take longer. Pass a {@link Date} to sleep until that time
   * is reached.
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
   * `Bun.sleep` and the imported `sleep` function are interchangeable.
   */
  function sleep(ms: number | Date): Promise<void>;

  /**
   * Block the thread for a given number of milliseconds.
   *
   * Internally, it calls [nanosleep(2)](https://man7.org/linux/man-pages/man2/nanosleep.2.html)
   */
  function sleepSync(ms: number): void;

  /**
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
   *
   * This hashing function balances speed with cryptographic strength. It does not encrypt or decrypt data.
   *
   * The implementation uses [BoringSSL](https://boringssl.googlesource.com/boringssl) (used in Chromium & Go)
   *
   * The equivalent `openssl` command is:
   *
   * ```bash
   * # You will need OpenSSL 3 or later
   * openssl sha512-256 /path/to/file
   * ```
   *
   * @category Utilities
   *
   * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster
   * @param hashInto optional `Uint8Array` to write the hash to. 32 bytes minimum.
   */
  function sha(input: Bun.StringOrBuffer, hashInto?: NodeJS.TypedArray): NodeJS.TypedArray;

  /**
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
   *
   * This hashing function balances speed with cryptographic strength. It does not encrypt or decrypt data.
   *
   * The implementation uses [BoringSSL](https://boringssl.googlesource.com/boringssl) (used in Chromium & Go)
   *
   * The equivalent `openssl` command is:
   *
   * ```bash
   * # You will need OpenSSL 3 or later
   * openssl sha512-256 /path/to/file
   * ```
   *
   * @category Utilities
   *
   * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster
   * @param encoding `DigestEncoding` to return the hash in
   */
  function sha(input: Bun.StringOrBuffer, encoding: DigestEncoding): string;

  /**
   * This is not the default because it's not cryptographically secure and it's slower than {@link SHA512}
   *
   * Consider {@link SHA512_256} instead
   */
  class SHA1 extends CryptoHashInterface<SHA1> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 20;
  }
  class MD5 extends CryptoHashInterface<MD5> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 16;
  }
  class MD4 extends CryptoHashInterface<MD4> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 16;
  }
  class SHA224 extends CryptoHashInterface<SHA224> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 28;
  }
  class SHA512 extends CryptoHashInterface<SHA512> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 64;
  }
  class SHA384 extends CryptoHashInterface<SHA384> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 48;
  }
  class SHA256 extends CryptoHashInterface<SHA256> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 32;
  }
  /**
   * See also {@link sha}
   */
  class SHA512_256 extends CryptoHashInterface<SHA512_256> {
    constructor();

    /**
     * The number of bytes the hash produces
     */
    static readonly byteLength: 32;
  }

  /** Extends the standard web formats with `brotli` and `zstd` support. */
  type CompressionFormat = "gzip" | "deflate" | "deflate-raw" | "brotli" | "zstd";

  /** Compression options for `Bun.deflateSync` and `Bun.gzipSync` */
  interface ZlibCompressionOptions {
    /**
     * The compression level to use. Must be between `-1` and `9`.
     * - `-1` uses the default compression level (`6`)
     * - `0` gives no compression
     * - `1` gives least compression, fastest speed
     * - `9` gives best compression, slowest speed
     */
    level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    /**
     * How much memory to allocate for the internal compression state.
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
     * - `9..15`: The output has a zlib header and footer (Deflate)
     * - `-9..-15`: The output does **not** have a zlib header or footer (Raw Deflate)
     * - `25..31` (16+`9..15`): The output has a gzip header and footer (gzip)
     *
     * The gzip header has no file name, no extra data, no comment, no modification time (set to zero) and no header CRC.
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
     * `Z_FILTERED` forces more Huffman coding and less string matching; it is
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
   * Compresses a chunk of data with the `zlib` DEFLATE algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  function deflateSync(
    data: Uint8Array<ArrayBuffer> | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array<ArrayBuffer>;
  /**
   * Compresses a chunk of data with the `zlib` GZIP algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  function gzipSync(
    data: Uint8Array<ArrayBuffer> | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array<ArrayBuffer>;
  /**
   * Decompresses a chunk of data with the `zlib` INFLATE algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  function inflateSync(
    data: Uint8Array<ArrayBuffer> | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array<ArrayBuffer>;
  /**
   * Decompresses a chunk of data with the `zlib` GUNZIP algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  function gunzipSync(
    data: Uint8Array<ArrayBuffer> | string | ArrayBuffer,
    options?: ZlibCompressionOptions | LibdeflateCompressionOptions,
  ): Uint8Array<ArrayBuffer>;

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
     * For bundles that run in the Bun runtime. Bundling server-side code is
     * often unnecessary, since Bun can run the source directly, but it can
     * reduce startup time and improve performance.
     *
     * All bundles generated with `target: "bun"` are marked with a special `// @bun` pragma, which
     * tells the Bun runtime that there's no need to re-transpile the file before execution.
     */
    | "bun"
    /**
     * The plugin is applied to Node.js builds
     */
    | "node"
    /**
     * The plugin is applied to browser builds
     */
    | "browser";

  /** https://bun.com/docs/bundler/loaders */
  type Loader =
    | "js"
    | "jsx"
    | "ts"
    | "tsx"
    | "json"
    | "jsonc"
    | "toml"
    | "yaml"
    | "file"
    | "napi"
    | "wasm"
    | "text"
    | "css"
    | "html";

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
     * @returns Promise that resolves when all modules have been parsed
     */
    defer: () => Promise<void>;
  }

  type OnLoadResult = OnLoadResultSourceCode | OnLoadResultObject | undefined | void;
  type OnLoadCallback = (args: OnLoadArgs) => OnLoadResult | Promise<OnLoadResult>;
  type OnStartCallback = () => void | Promise<void>;
  type OnEndCallback = (result: BuildOutput) => void | Promise<void>;
  type OnBeforeParseCallback = {
    napiModule: unknown;
    symbol: string;
    external?: unknown | undefined;
  };

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
     * It is concatenated with `path` to form the final import specifier
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
     * Register a callback that runs when bundling starts. With hot module
     * reloading, it runs at the start of each incremental rebuild.
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
    /**
     * Register a callback that runs when bundling ends, after all modules
     * have been bundled and the build is complete.
     *
     * @example
     * ```ts
     * const plugin: Bun.BunPlugin = {
     *   name: "my-plugin",
     *   setup(builder) {
     *     builder.onEnd((result) => {
     *       console.log("bundle just finished!!", result);
     *     });
     *   },
     * };
     * ```
     *
     * @returns `this` for method chaining
     */
    onEnd(callback: OnEndCallback): this;
    onBeforeParse(constraints: PluginConstraints, callback: OnBeforeParseCallback): this;
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
     * - `browser`: The plugin is applied to browser builds
     * - `node`: The plugin is applied to Node.js builds
     *
     * If unspecified, the plugin is assumed to be compatible with all targets.
     *
     * This field is not read by {@link Bun.plugin}, only {@link Bun.build} and `bun build`
     */
    target?: Target;

    /**
     * Called when the plugin is loaded.
     *
     * This function may be called in the same tick that it is registered, or it
     * may be called later. It may be called multiple times for different
     * targets.
     */
    setup(
      /**
       * The builder object for registering plugin hooks
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
   * There are two kinds of hooks:
   * - `onLoad` returns source code or an object that becomes the module's exports
   * - `onResolve` redirects a module specifier to another module specifier. It does not chain.
   *
   * Plugin hooks must define a `filter` RegExp and only match when the
   * import specifier contains a "." or a ":".
   *
   * ES Module resolution semantics mean that plugins may be initialized _after_
   * a module is resolved. You might need to load plugins at the very beginning
   * of the application and then use a dynamic import to load the rest of the
   * application. A future version of Bun may also support specifying plugins
   * in `bunfig.toml`.
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
   *  }
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
   * Whether the current global scope is the main thread
   */
  const isMainThread: boolean;

  /**
   * The result of importing an HTML file, at runtime or at build time.
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
      /** The loader used for this file, such as `js`, `css`, or `html` */
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
   * A TCP or TLS socket connection.
   *
   * Sockets are created with `Bun.connect()` or accepted by a `Bun.listen()` server.
   *
   * @category HTTP & Networking
   */
  interface Socket<Data = undefined> extends Disposable {
    /**
     * Writes `data` to the socket. This method is unbuffered and non-blocking. It uses the `sendto(2)` syscall internally.
     *
     * For best performance with many small writes, batch them into a single
     * `socket.write()` call.
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
     * Set it when the socket is created with `Bun.connect({ data: ... })`.
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
     * Calls the `shutdown(2)` syscall internally.
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
     * A positive value means the socket is open and usable
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
     *
     * This attempts to send the data immediately, but success depends on the network conditions
     * and the receiving end.
     * It might be necessary after several `write` calls if immediate sending is critical,
     * though the OS often handles flushing efficiently. `write` calls outside
     * `open`/`data`/`drain` might benefit from manual `cork`/`flush`.
     */
    flush(): void;

    /**
     * Reset the socket's callbacks. This is useful with `bun --hot` for hot reloading.
     *
     * This applies to all sockets from the same {@link Listener}. It is per socket only for {@link Bun.connect}.
     */
    reload(options: Pick<SocketOptions<Data>, "socket">): void;

    /**
     * The server that created this socket
     *
     * This is `undefined` if the socket was created by {@link Bun.connect} or if the listener has already closed.
     */
    readonly listener?: SocketListener;

    /**
     * IP protocol family used for the remote endpoint of the socket
     * @example "IPv4" | "IPv6"
     */
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
     * Local port connected to the socket
     * @example 8080
     */
    readonly localPort: number;

    /**
     * `true` if the peer certificate was signed by one of the CAs
     * specified when creating the `Socket` instance, otherwise `false`
     */
    readonly authorized: boolean;

    /**
     * The selected ALPN protocol.
     *
     * Before a handshake has completed, this value is always `null`.
     * When a handshake has completed but no ALPN protocol was selected, this is `false`.
     */
    readonly alpnProtocol: string | false | null;

    /**
     * Disables TLS renegotiation for this `Socket` instance. Once called, attempts
     * to renegotiate will trigger an `error` handler on the `Socket`.
     *
     * Bun does not support renegotiation as a server. (Attempts by clients result in a fatal alert so that ClientHello messages cannot be used to flood a server and escape higher-level limits.)
     */
    disableRenegotiation(): void;

    /**
     * Keying material is used for validations to prevent different kinds of attacks in
     * network protocols, for example in the specifications of IEEE 802.1X.
     *
     * @example
     * ```js
     * const keyingMaterial = socket.exportKeyingMaterial(
     *   128,
     *   'client finished');
     *
     * // Example return value of keyingMaterial:
     * // <Buffer 76 26 af 99 c5 56 8e 42 09 91 ef 9f 93 cb ad 6c 7b 65 f8 53 f1 d8 d9
     * //    12 5a 33 b8 b5 25 df 7b 37 9f e0 e2 4f b8 67 83 a3 2f cd 5d 41 42 4c 91
     * //    74 ef 2c ... 78 more bytes>
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
     * Returns the reason why the peer's certificate was not verified. This is
     * only set when `socket.authorized === false`.
     */
    getAuthorizationError(): Error | null;

    /**
     * Returns an object representing the local certificate. The returned object has
     * some properties corresponding to the fields of the certificate.
     *
     * If there is no local certificate, an empty object is returned. If the
     * socket has been destroyed, `null` is returned.
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
     * ephemeral. This is only supported on a client socket; `null` is returned
     * if called on a server socket. The supported types are `'DH'` and `'ECDH'`. The `name` property is available only when type is `'ECDH'`.
     *
     * For example: `{ type: 'ECDH', name: 'prime256v1', size: 256 }`.
     */
    getEphemeralKeyInfo(): import("tls").EphemeralKeyInfo | object | null;

    /**
     * Returns an object representing the peer's certificate. If the peer does not
     * provide a certificate, an empty object is returned. If the socket has been
     * destroyed, `null` is returned.
     *
     * If the full certificate chain was requested, each certificate includes an `issuerCertificate` property containing an object representing its issuer's
     * certificate.
     * @return A certificate object.
     */
    getPeerCertificate(): import("node:tls").PeerCertificate;
    getPeerX509Certificate(): import("node:crypto").X509Certificate;

    /**
     * See [SSL\_get\_shared\_sigalgs](https://www.openssl.org/docs/man1.1.1/man3/SSL_get_shared_sigalgs.html) for more information.
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
     * For a client, returns the TLS session ticket if one is available, or `undefined`. For a server, always returns `undefined`.
     *
     * It may be useful for debugging.
     *
     * See `Session Resumption` for more information.
     */
    getTLSTicket(): Buffer | undefined;

    /**
     * Returns a string containing the negotiated SSL/TLS protocol version of the
     * current connection. The value `'unknown'` is returned for connected
     * sockets that have not completed the handshaking process. The value `null` is
     * returned for server sockets or disconnected client sockets.
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
     * **TLS only:** Checks if the current TLS session was resumed from a previous session.
     *
     * See `Session Resumption` for more information.
     * @return `true` if the session was reused, `false` otherwise
     */
    isSessionReused(): boolean;

    /**
     * Sets the maximum TLS fragment size.
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
     * Only available for already connected sockets; returns `false` otherwise
     * @param noDelay Default: `true`
     * @returns `true` if it succeeds, `false` if it fails
     */
    setNoDelay(noDelay?: boolean): boolean;

    /**
     * Enable/disable keep-alive functionality, and optionally set the initial delay before the first keepalive probe is sent on an idle socket.
     * Set `initialDelay` (in milliseconds) to set the delay between the last data packet received and the first keepalive probe.
     * Setting `0` for `initialDelay` (the default) will leave the value unchanged from the default (or previous) setting.
     * Only available for already connected sockets; returns `false` otherwise.
     *
     * Enabling the keep-alive functionality sets the following socket options:
     * SO_KEEPALIVE=1
     * TCP_KEEPIDLE=initialDelay/1000
     * TCP_KEEPCNT=10
     * TCP_KEEPINTVL=1
     * @param enable Default: `false`
     * @param initialDelay Default: `0`
     * @returns `true` if it succeeds, `false` if it fails
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
    reload(options: Pick<SocketOptions<Data>, "socket">): void;
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
    uint8array: Uint8Array<ArrayBuffer>;
    // TODO: DataView
    // dataview: DataView;
  }
  type BinaryType = keyof BinaryTypeList;

  interface SocketHandler<Data = unknown, DataBinaryType extends BinaryType = "buffer"> {
    /**
     * Called when the socket connects. For TLS sockets with no `handshake`
     * handler, this is called only after the handshake completes.
     */
    open?(socket: Socket<Data>): void | Promise<void>;
    close?(socket: Socket<Data>, error?: Error): void | Promise<void>;
    error?(socket: Socket<Data>, error: Error): void | Promise<void>;
    data?(socket: Socket<Data>, data: BinaryTypeList[DataBinaryType]): void | Promise<void>;
    drain?(socket: Socket<Data>): void | Promise<void>;

    /**
     * Called when the TLS handshake completes.
     * @param success Whether the server authorized the connection despite `authorizationError`
     * @param authorizationError The certificate authorization error, or `null` if there was none
     */
    handshake?(socket: Socket<Data>, success: boolean, authorizationError: Error | null): void;

    /**
     * Called when the other end shuts down its side of the socket by sending
     * a TCP FIN packet.
     */
    end?(socket: Socket<Data>): void | Promise<void>;

    /**
     * Called when the socket fails to be created.
     *
     * The promise returned by `Bun.connect` rejects **after** this function is
     * called.
     *
     * When `connectError` is specified, the rejected promise is not added to
     * the promise rejection queue (so it isn't reported as an unhandled
     * promise rejection, since `connectError` handles it).
     *
     * When `connectError` is not specified, the rejected promise is added to
     * the promise rejection queue.
     */
    connectError?(socket: Socket<Data>, error: Error): void | Promise<void>;

    /**
     * Called when a message times out.
     */
    timeout?(socket: Socket<Data>): void | Promise<void>;
    /**
     * Choose what `ArrayBufferView` is passed to the {@link SocketHandler.data} callback.
     *
     * @default "buffer"
     *
     * @remarks
     * A small performance optimization: picking the type you need avoids
     * creating extra `ArrayBufferView` objects when possible.
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
     * TLS configuration with which to create the socket
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
     * TLS configuration with which to create the socket
     */
    tls?: TLSOptions | boolean;
  }

  interface FdSocketOptions<Data = undefined> extends SocketOptions<Data> {
    /**
     * TLS configuration with which to create the socket
     */
    tls?: TLSOptions | boolean;
    /**
     * The file descriptor to connect to
     */
    fd: number;
  }

  /**
   * Create a TCP client that connects to a server
   *
   * @category HTTP & Networking
   */
  function connect<Data = undefined>(options: TCPSocketConnectOptions<Data>): Promise<Socket<Data>>;
  /**
   * Create a client that connects to a server over a Unix socket
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
   * Create a server that listens on a Unix socket
   *
   * @category HTTP & Networking
   */
  function listen<Data = undefined>(options: UnixSocketOptions<Data>): UnixSocketListener<Data>;

  /**
   * @category HTTP & Networking
   */
  namespace udp {
    type Data = string | ArrayBufferView | ArrayBufferLike;

    /**
     * Extra metadata passed to the `data` callback for each received datagram.
     */
    export interface ReceiveFlags {
      /**
       * `true` if the datagram was larger than the receive buffer and was
       * truncated by the kernel (MSG_TRUNC). The `data` passed to the
       * callback contains only the portion that fit in the buffer.
       */
      truncated: boolean;
      /**
       * `true` if the datagram's source address was IPv6, `false` for IPv4.
       * Reflects the packet's own `sockaddr` — a socket adopting an existing
       * fd may receive packets of the other family than it was created with.
       */
      ipv6: boolean;
    }

    export interface SocketHandler<DataBinaryType extends BinaryType> {
      data?(
        socket: Socket<DataBinaryType>,
        data: BinaryTypeList[DataBinaryType],
        port: number,
        address: string,
        flags: ReceiveFlags,
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
        flags: ReceiveFlags,
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
      /**
       * Enable or disable the SO_BROADCAST socket option.
       * @param enabled Whether to enable broadcast
       * @returns The enabled value
       */
      setBroadcast(enabled: boolean): boolean;
      /**
       * Set the IP_TTL socket option.
       * @param ttl Time to live value
       * @returns The TTL value
       */
      setTTL(ttl: number): number;
      /**
       * Set the IP_MULTICAST_TTL socket option.
       * @param ttl Time to live value for multicast packets
       * @returns The TTL value
       */
      setMulticastTTL(ttl: number): number;
      /**
       * Enable or disable the IP_MULTICAST_LOOP socket option.
       * @param enabled Whether to enable multicast loopback
       * @returns The enabled value
       */
      setMulticastLoopback(enabled: boolean): boolean;
      /**
       * Set the IP_MULTICAST_IF socket option to specify the outgoing interface
       * for multicast packets.
       * @param interfaceAddress The address of the interface to use
       * @returns true on success
       */
      setMulticastInterface(interfaceAddress: string): boolean;
      /**
       * Join a multicast group.
       * @param multicastAddress The multicast group address
       * @param interfaceAddress Optional interface address to use
       * @returns true on success
       */
      addMembership(multicastAddress: string, interfaceAddress?: string): boolean;
      /**
       * Leave a multicast group.
       * @param multicastAddress The multicast group address
       * @param interfaceAddress Optional interface address to use
       * @returns true on success
       */
      dropMembership(multicastAddress: string, interfaceAddress?: string): boolean;
      /**
       * Join a source-specific multicast group.
       * @param sourceAddress The source address
       * @param groupAddress The multicast group address
       * @param interfaceAddress Optional interface address to use
       * @returns true on success
       */
      addSourceSpecificMembership(sourceAddress: string, groupAddress: string, interfaceAddress?: string): boolean;
      /**
       * Leave a source-specific multicast group.
       * @param sourceAddress The source address
       * @param groupAddress The multicast group address
       * @param interfaceAddress Optional interface address to use
       * @returns true on success
       */
      dropSourceSpecificMembership(sourceAddress: string, groupAddress: string, interfaceAddress?: string): boolean;
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
   * @param options The options to use when creating the socket
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

  /**
   * @deprecated use {@link Bun.Spawn} instead
   */
  export import SpawnOptions = Spawn;

  namespace Spawn {
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

    /**
     * @deprecated use BaseOptions or the specific options for the specific {@link spawn} or {@link spawnSync} usage
     */
    type OptionsObject<In extends Writable, Out extends Readable, Err extends Readable> = BaseOptions<In, Out, Err>;

    interface BaseOptions<In extends Writable, Out extends Readable, Err extends Readable> {
      /**
       * The current working directory of the process
       *
       * Defaults to `process.cwd()`
       */
      cwd?: string;

      /**
       * Run the child in a separate process group, detached from the parent.
       *
       * - POSIX: calls `setsid()` so the child starts a new session and becomes
       *   the process group leader. It can outlive the parent and receive
       *   signals independently of the parent’s terminal/process group.
       * - Windows: sets `UV_PROCESS_DETACHED`, allowing the child to outlive
       *   the parent and receive signals independently.
       *
       * Note: stdio may keep the parent process alive. Pass `stdio: ["ignore",
       * "ignore", "ignore"]` to the spawn constructor to prevent this.
       *
       * @default false
       */
      detached?: boolean;

      /**
       * Sets the user identity of the child process (see setuid(2)).
       *
       * POSIX only. On Windows the spawn fails with `ENOTSUP`.
       */
      uid?: number;

      /**
       * Sets the group identity of the child process (see setgid(2)).
       *
       * POSIX only. On Windows the spawn fails with `ENOTSUP`.
       */
      gid?: number;

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
       * - `"ignore"`, `null`, `undefined`: The process has no standard input (default)
       * - `"pipe"`: The process has a new {@link FileSink} for standard input
       * - `"inherit"`: The process inherits the standard input of the current process
       * - `ArrayBufferView`, `Blob`, `Bun.file()`, `Response`, `Request`: The process reads from buffer/stream.
       * - `number`: The process reads from the file descriptor
       *
       * For stdout and stderr you may pass:
       *
       * - `"pipe"`, `undefined`: The process has a {@link ReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process has no standard output/error
       * - `"inherit"`: The process inherits the standard output/error of the current process
       * - `ArrayBufferView`: The process writes to the preallocated buffer. Not implemented.
       * - `number`: The process writes to the file descriptor
       *
       * At indices >= 3, `"socket-fd"` (POSIX only) is also accepted:
       * creates a socketpair like `"pipe"`, but the parent-end fd exposed
       * via {@link Subprocess.stdio} is owned by the caller and is never
       * closed by the subprocess. Use this when you wrap the fd in
       * something that will close it itself (e.g. `net.connect({fd})`).
       * On Windows it behaves the same as `"pipe"`.
       *
       * @default ["ignore", "pipe", "inherit"] for `spawn`
       * ["ignore", "pipe", "pipe"] for `spawnSync`
       */
      stdio?: [In, Out, Err, ...(Readable | "socket-fd")[]];

      /**
       * The file descriptor for the standard input. It may be:
       *
       * - `"ignore"`, `null`, `undefined`: The process has no standard input
       * - `"pipe"`: The process has a new {@link FileSink} for standard input
       * - `"inherit"`: The process inherits the standard input of the current process
       * - `ArrayBufferView`, `Blob`: The process reads from the buffer
       * - `number`: The process reads from the file descriptor
       *
       * @default "ignore"
       */
      stdin?: In;
      /**
       * The file descriptor for the standard output. It may be:
       *
       * - `"pipe"`, `undefined`: The process has a {@link ReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process has no standard output/error
       * - `"inherit"`: The process inherits the standard output/error of the current process
       * - `ArrayBufferView`: The process writes to the preallocated buffer. Not implemented.
       * - `number`: The process writes to the file descriptor
       *
       * @default "pipe"
       */
      stdout?: Out;
      /**
       * The file descriptor for the standard error. It may be:
       *
       * - `"pipe"`, `undefined`: The process has a {@link ReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process has no standard output/error
       * - `"inherit"`: The process inherits the standard output/error of the current process
       * - `ArrayBufferView`: The process writes to the preallocated buffer. Not implemented.
       * - `number`: The process writes to the file descriptor
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
       * An alternative is `await subprocess.exited`.
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
         * If an error occurred in the call to waitpid2, this is the error.
         */
        error?: ErrorLike,
      ): void | Promise<void>;

      /**
       * Called exactly once when the IPC channel between the parent and this
       * subprocess is closed. After this runs, no further IPC messages will be
       * delivered.
       *
       * When it fires:
       * - The child called `process.disconnect()` or the parent called
       *   `subprocess.disconnect()`.
       * - The child exited for any reason (normal exit or due to a signal like
       *   `SIGILL`, `SIGKILL`, etc.).
       * - The child replaced itself with a program that does not support Bun
       *   IPC.
       *
       * Notes:
       * - This callback indicates that the pipe is closed; it is not an error
       *   by itself. Use {@link onExit} or {@link Subprocess.exited} to
       *   determine why the process ended.
       * - It may occur before or after {@link onExit} depending on timing; do
       *   not rely on ordering. Typically, if you or the child call
       *   `disconnect()` first, this fires before {@link onExit}; if the
       *   process exits without an explicit disconnect, either may happen
       *   first.
       * - Only runs when {@link ipc} is enabled and runs at most once per
       *   subprocess.
       * - If the child becomes a zombie (exited but not yet reaped), the IPC is
       *   already closed, and this callback will fire (or may already have
       *   fired).
       *
       * @example
       *
       * ```ts
       * const subprocess = spawn({
       *  cmd: ["echo", "hello"],
       *  ipc: (message) => console.log(message),
       *  onDisconnect: () => {
       *    console.log("IPC channel disconnected");
       *  },
       * });
       * ```
       */
      onDisconnect?(): void | Promise<void>;

      /**
       * When specified, Bun opens an IPC channel to the subprocess. The passed callback is called for
       * incoming messages, and `subprocess.send` can send messages to the subprocess. Messages are serialized
       * using the JSC serialize API, which allows the same types that `postMessage`/`structuredClone` supports.
       *
       * The subprocess can send and receive messages with `process.send` and `process.on("message")`,
       * respectively. This is the same API that Node.js exposes when `child_process.fork()` is used.
       *
       * This is only compatible with processes that are other `bun` instances.
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
       * If true, the subprocess has a hidden window.
       */
      windowsHide?: boolean;

      /**
       * If true, no quoting or escaping of arguments is done on Windows.
       */
      windowsVerbatimArguments?: boolean;

      /**
       * Path to the executable to run in the subprocess.
       *
       * Use this to wrap another application or to simulate a symlink.
       *
       * @default cmds[0]
       */
      argv0?: string;

      /**
       * An {@link AbortSignal} that kills the subprocess when aborted.
       *
       * Use this to abort the subprocess when another part of the program is
       * aborted, such as a `fetch`.
       *
       * If the signal is aborted, the process is killed with the signal
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
       * If the timeout is reached, the process is killed with the signal
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

    interface SpawnSyncOptions<In extends Writable, Out extends Readable, Err extends Readable>
      extends BaseOptions<In, Out, Err> {}

    interface SpawnOptions<In extends Writable, Out extends Readable, Err extends Readable>
      extends BaseOptions<In, Out, Err> {
      /**
       * If true, the stdout and stderr pipes don't automatically start reading
       * data. Reading begins only when you access the `stdout` or `stderr`
       * properties.
       *
       * This can improve performance when you don't need to read output
       * immediately.
       *
       * @default false
       *
       * @example
       * ```ts
       * const subprocess = Bun.spawn({
       *   cmd: ["echo", "hello"],
       *   lazy: true, // Don't start reading stdout until accessed
       * });
       * // stdout reading hasn't started yet
       * await subprocess.stdout.text(); // Now reading starts
       * ```
       */
      lazy?: boolean;

      /**
       * Spawn the subprocess with a pseudo-terminal (PTY) attached.
       *
       * When this option is provided:
       * - `stdin`, `stdout`, and `stderr` are all connected to the terminal
       * - The subprocess sees itself running in a real terminal (`isTTY = true`)
       * - Access the terminal via `subprocess.terminal`
       * - `subprocess.stdin`, `subprocess.stdout`, `subprocess.stderr` return `null`
       *
       * Only available on POSIX systems (Linux, macOS).
       *
       * @example
       * ```ts
       * const proc = Bun.spawn(["bash"], {
       *   terminal: {
       *     cols: 80,
       *     rows: 24,
       *     data: (term, data) => console.log(data.toString()),
       *   },
       * });
       *
       * proc.terminal.write("echo hello\n");
       * await proc.exited;
       * proc.terminal.close();
       * ```
       *
       * You can also pass an existing `Terminal` object for reuse across multiple spawns:
       * ```ts
       * const terminal = new Bun.Terminal({ ... });
       * const proc1 = Bun.spawn(["echo", "first"], { terminal });
       * await proc1.exited;
       * const proc2 = Bun.spawn(["echo", "second"], { terminal });
       * await proc2.exited;
       * terminal.close();
       * ```
       */
      terminal?: TerminalOptions | Terminal;
    }

    type ReadableToIO<X extends Readable> = X extends "pipe" | undefined
      ? ReadableStream<Uint8Array<ArrayBuffer>>
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
     * The maximum resident set size (in bytes) used by the process during its lifetime.
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
     * The number of times the process was swapped out of main memory.
     */
    swapCount: number;
  }

  /**
   * A process created by {@link Bun.spawn}.
   *
   * The 3 optional type parameters correspond to the `stdio` array from the options object. Instead of specifying them, use one of these utility types:
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
     * The terminal attached to this subprocess, if spawned with the `terminal` option.
     * `undefined` if no terminal was attached.
     *
     * When a terminal is attached, `stdin`, `stdout`, and `stderr` return `null`.
     * Use `terminal.write()` and the `data` callback instead.
     *
     * @example
     * ```ts
     * const proc = Bun.spawn(["bash"], {
     *   terminal: { data: (term, data) => console.log(data.toString()) },
     * });
     *
     * proc.terminal?.write("echo hello\n");
     * ```
     */
    readonly terminal: Terminal | undefined;

    /**
     * Extra file descriptors passed to the `stdio` option.
     *
     * Entries beyond index 2 are `number` for `"pipe"` and `"socket-fd"` slots and,
     * on POSIX, for slots where a raw file descriptor was supplied (the same fd is
     * returned). On POSIX, reading this property transfers ownership of any
     * `"pipe"` fds to the caller, who is then responsible for closing them; the
     * subprocess will not close them. `"socket-fd"` and raw-fd slots are likewise
     * caller-owned. Other slots — including raw fds on Windows — are `null`.
     */
    readonly stdio: [null, null, null, ...(number | null)[]];

    /**
     * The same value as {@link Subprocess.stdout}
     *
     * Exists for compatibility with {@link ReadableStream.pipeThrough}
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
     * The promise resolves when the process exits
     */
    readonly exited: Promise<number>;

    /**
     * Synchronously get the exit code of the process
     *
     * `null` if the process hasn't exited yet
     */
    readonly exitCode: number | null;

    /**
     * Synchronously get the signal code of the process
     *
     * `null` if the process never sent a signal code
     *
     * To receive signal code changes, use the `onExit` callback.
     *
     * If the signal code is unknown, this is the original signal code
     * number, but that case should never happen in practice.
     */
    readonly signalCode: NodeJS.Signals | null;

    /**
     * Whether the process has exited
     */
    readonly killed: boolean;

    /**
     * Kill the process
     * @param exitCode Exit code or signal to send to the process
     */
    kill(exitCode?: number | NodeJS.Signals): void;

    /**
     * Tell Bun to wait for this process to exit after you already
     * called `unref()`.
     *
     * By default, Bun waits for all subprocesses to exit before shutting down
     */
    ref(): void;

    /**
     * Tell Bun not to wait for this process to exit before shutting down.
     *
     * By default, Bun waits for all subprocesses to exit before shutting down.
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
     * Get the resource usage of the process, such as max RSS and CPU time
     *
     * Returns `undefined` until the process has exited
     */
    resourceUsage(): ResourceUsage | undefined;
  }

  /**
   * A process created by {@link Bun.spawnSync}.
   *
   * The 2 optional type parameters correspond to the `stdout` and `stderr` options. Instead of specifying them, use one of these utility types:
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
     * Resource usage of the process, such as max RSS and CPU time
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
   * const proc = Bun.spawn({
   *  cmd: ["echo", "hello"],
   *  stdout: "pipe",
   * });
   * const text = await proc.stdout.text();
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
    options: SpawnOptions.SpawnOptions<In, Out, Err> & {
      /**
       * The command to run
       *
       * The first argument is resolved to an absolute executable path. It must be a file, not a directory.
       *
       * If you explicitly set `PATH` in `env`, that `PATH` is used to resolve the executable instead of the default `PATH`.
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
   * const proc = Bun.spawn(["echo", "hello"]);
   * const text = await proc.stdout.text();
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
     * The first argument is resolved to an absolute executable path. It must be a file, not a directory.
     *
     * If you explicitly set `PATH` in `env`, that `PATH` is used to resolve the executable instead of the default `PATH`.
     *
     * To check if the command exists before running it, use `Bun.which(bin)`.
     *
     * @example
     * ```ts
     * const subprocess = Bun.spawn(["echo", "hello"]);
     * ```
     */
    cmds: string[],
    options?: SpawnOptions.SpawnOptions<In, Out, Err>,
  ): Subprocess<In, Out, Err>;

  /**
   * Synchronously spawn a new process
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
    const In extends SpawnOptions.Writable = "ignore",
    const Out extends SpawnOptions.Readable = "pipe",
    const Err extends SpawnOptions.Readable = "pipe",
  >(
    options: SpawnOptions.SpawnSyncOptions<In, Out, Err> & {
      /**
       * The command to run
       *
       * The first argument is resolved to an absolute executable path. It must be a file, not a directory.
       *
       * If you explicitly set `PATH` in `env`, that `PATH` is used to resolve the executable instead of the default `PATH`.
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
    const In extends SpawnOptions.Writable = "ignore",
    const Out extends SpawnOptions.Readable = "pipe",
    const Err extends SpawnOptions.Readable = "pipe",
  >(
    /**
     * The command to run
     *
     * The first argument is resolved to an absolute executable path. It must be a file, not a directory.
     *
     * If you explicitly set `PATH` in `env`, that `PATH` is used to resolve the executable instead of the default `PATH`.
     *
     * To check if the command exists before running it, use `Bun.which(bin)`.
     *
     * @example
     * ```ts
     * const subprocess = Bun.spawnSync(["echo", "hello"]);
     * ```
     */
    cmds: string[],
    options?: SpawnOptions.SpawnSyncOptions<In, Out, Err>,
  ): SyncSubprocess<Out, Err>;

  /**
   * Controller object passed to the `scheduled()` handler when a cron job fires.
   *
   * Compatible with [Cloudflare Workers' ScheduledController](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).
   */
  interface CronController {
    /** The type of event that triggered the handler. Always `"scheduled"`. */
    readonly type: "scheduled";
    /** The cron expression that triggered this invocation. */
    readonly cron: string;
    /** Timestamp (ms since epoch) when the job was scheduled to run. */
    readonly scheduledTime: number;
  }

  /**
   * A cron schedule: a 5-field expression (`minute hour day month weekday`) or a nickname.
   *
   * Nicknames: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`.
   *
   * Fields support `*`, numbers, ranges (`1-5`), steps (`1-30/2`),
   * comma lists (`1,5,10`), and month/weekday names (`JAN`-`DEC`, `SUN`-`SAT`).
   *
   * Validated at runtime by the cron parser.
   */
  type CronWithAutocomplete =
    | "@yearly"
    | "@annually"
    | "@monthly"
    | "@weekly"
    | "@daily"
    | "@midnight"
    | "@hourly"
    | "* * * * *"
    | "0 * * * *"
    | "0 0 * * *"
    | "0 0 * * 0"
    | "0 0 1 * *"
    | "0 0 1 1 *"
    | `${string} ${string} ${string} ${string} ${string}`
    | (string & {});

  /**
   * A handle to an in-process cron job returned by {@link Bun.cron} when called with a callback.
   *
   * @example
   * ```ts
   * const job = Bun.cron("0 * * * *", async () => {
   *   await cleanupTempFiles();
   * });
   * // Later:
   * job.stop();
   * ```
   */
  interface CronJob extends Disposable {
    /** The schedule expression this job was created with. */
    readonly cron: string;
    /** Cancel this cron job. The callback will not fire again. */
    stop(): CronJob;
    /** Keep the process alive while this job is scheduled (default). */
    ref(): CronJob;
    /** Allow the process to exit even while this job is scheduled. */
    unref(): CronJob;
  }

  /**
   * Options for the in-process {@link Bun.cron} callback overload and {@link Bun.cron.parse}.
   */
  interface CronOptions {
    /**
     * IANA time-zone name to interpret the schedule in (e.g. `"UTC"`,
     * `"America/New_York"`). Defaults to the system's local time zone.
     */
    tz?: string;
  }

  /**
   * Schedule cron jobs.
   *
   * Call with a callback to run an in-process job, or with a module path and
   * title to register an OS-level job. {@link Bun.cron.parse} previews the next
   * fire time; {@link Bun.cron.remove} unregisters an OS-level job.
   */
  const cron: {
    /**
     * Schedule an **in-process** cron job that calls a function on a schedule.
     *
     * Unlike the module-path overload, this runs the callback on the current event loop —
     * the job dies with the process and does not survive reboots. State is shared between
     * invocations (closures, module-level variables, database connections all persist).
     *
     * | | In-process (this overload) | OS-level (path + title) |
     * |---|---|---|
     * | Survives process exit | No | Yes |
     * | Shared state between runs | Yes | No (fresh process each time) |
     * | Windows expression limits | None | 48-trigger cap |
     * | Return type | {@link CronJob} (sync) | `Promise<void>` |
     *
     * ### No-overlap guarantee
     *
     * The next fire time is computed only after the callback settles (including any returned
     * Promise). If your callback takes 3 minutes and runs every minute, it fires at T+0 → runs
     * until T+3 → next fire is the first minute boundary after T+3. Invocations never stack.
     *
     * ### Error semantics
     *
     * Matches `setTimeout`: a synchronous throw emits `uncaughtException`, a rejected Promise
     * emits `unhandledRejection`. Without a listener, the process exits with code 1. The job
     * reschedules itself after an error — it does not stop on first failure.
     *
     * ```ts
     * process.on("unhandledRejection", (err) => log.error(err)); // keep going
     * Bun.cron("* * * * *", async () => { await mightThrow(); });
     * ```
     *
     * ### Cron expression syntax
     *
     * Five fields: `minute hour day-of-month month day-of-week`.
     *
     * | Field | Values | Special chars |
     * |-------|--------|---------------|
     * | Minute | `0-59` | `*` `,` `-` `/` |
     * | Hour | `0-23` | `*` `,` `-` `/` |
     * | Day of month | `1-31` | `*` `,` `-` `/` |
     * | Month | `1-12` or `JAN`-`DEC` | `*` `,` `-` `/` |
     * | Day of week | `0-7` or `SUN`-`SAT` | `*` `,` `-` `/` |
     *
     * - `0` and `7` both mean Sunday.
     * - Month and weekday names are case-insensitive (`MON`, `Monday`, `jan`, `January` all work).
     * - Nicknames: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`.
     * - When both day-of-month and day-of-week are restricted (neither is `*`), the job
     *   fires when **either** matches — [POSIX cron](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html) OR semantics.
     * - All expressions work on all platforms — there is no Windows trigger limit here.
     *
     * ### Lifecycle & `--hot`
     *
     * Under `bun --hot`, all in-process cron jobs are stopped immediately before the module
     * graph is re-evaluated. Each `Bun.cron()` call still in your source then re-registers,
     * so editing the schedule, editing the callback, or **deleting the line entirely** all
     * take effect on save without leaking timers.
     *
     * By default the job keeps the process alive (like `setInterval`); call `.unref()` to let
     * the process exit naturally when nothing else is pending.
     *
     * @param schedule Cron expression or nickname (e.g. `"*\/5 * * * *"`, `"@hourly"`).
     * @param handler Function to call on each fire. May return a Promise — the next fire
     *   is not scheduled until it settles.
     * @returns A {@link CronJob} handle. Chainable: `.stop()`, `.ref()`, `.unref()` all
     *   return the job itself.
     * @throws Synchronously if `schedule` is invalid, or the expression has no future
     *   occurrences (e.g. `"0 0 30 2 *"` — February 30th).
     *
     * @example
     * ```ts
     * // Hourly cleanup, keeps process alive
     * Bun.cron("0 * * * *", async () => {
     *   await cleanupTempFiles();
     * });
     *
     * // Background healthcheck that doesn't block process exit
     * Bun.cron("*\/30 * * * *", () => fetch("https://example.com/health")).unref();
     *
     * // Stop conditionally
     * const job = Bun.cron("* * * * *", async () => {
     *   if (await isDone()) job.stop();
     * });
     * ```
     *
     * @see {@link CronJob} for the returned handle.
     * @see {@link Bun.cron.parse} to preview the next fire time.
     */
    (schedule: CronWithAutocomplete, handler: (this: CronJob) => unknown, options?: CronOptions): CronJob;
    /**
     * Register an **OS-level** cron job that runs a JavaScript/TypeScript module on a schedule.
     *
     * Unlike the callback overload, this registers the job with the operating system's
     * scheduler — the job survives process exit and persists across reboots. Bun spawns
     * a fresh process for each invocation, so there is no shared state between runs.
     *
     * | Platform | Scheduler | Inspect with |
     * |----------|-----------|--------------|
     * | Linux    | [crontab](https://man7.org/linux/man-pages/man5/crontab.5.html) | `crontab -l` |
     * | macOS    | [launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) | `launchctl list` |
     * | Windows  | [Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page) | `schtasks /query` |
     *
     * ### Module shape
     *
     * The target module must have a `default` export with a `scheduled(controller)` method,
     * matching the [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
     * API. The controller exposes `cron` (the expression) and `scheduledTime` (ms since epoch).
     *
     * ```ts
     * // worker.ts
     * export default {
     *   async scheduled(controller: Bun.CronController) {
     *     console.log(`Fired: ${controller.cron} at ${new Date(controller.scheduledTime)}`);
     *     await doWork();
     *   },
     * };
     * ```
     *
     * ### Cron expression syntax
     *
     * Five fields: `minute hour day-of-month month day-of-week`.
     *
     * | Field | Values | Special chars |
     * |-------|--------|---------------|
     * | Minute | `0-59` | `*` `,` `-` `/` |
     * | Hour | `0-23` | `*` `,` `-` `/` |
     * | Day of month | `1-31` | `*` `,` `-` `/` |
     * | Month | `1-12` or `JAN`-`DEC` | `*` `,` `-` `/` |
     * | Day of week | `0-7` or `SUN`-`SAT` | `*` `,` `-` `/` |
     *
     * - `0` and `7` both mean Sunday.
     * - Month and weekday names are case-insensitive (`MON`, `Monday`, `jan`, `January` all work).
     * - Nicknames: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`.
     * - When both day-of-month and day-of-week are restricted (neither is `*`), the job
     *   fires when **either** matches — [POSIX cron](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html) OR semantics.
     *
     * ### Platform caveats
     *
     * - **Windows:** minute steps that don't evenly divide 60 (e.g. `*\/7`, `*\/11`) with
     *   all hours active exceed Task Scheduler's 48-trigger limit and throw. Divisors
     *   of 60 (`*\/5`, `*\/10`, `*\/15`, `*\/20`, `*\/30`) and all common patterns work.
     * - **Windows headless/CI:** registration fails if the current user's SID can't be
     *   resolved (typical under service accounts). Run as a regular user or create the
     *   task manually with `schtasks /create /ru SYSTEM`.
     * - **macOS:** stdout/stderr are written to `/tmp/bun.cron.<title>.{stdout,stderr}.log`.
     *
     * ### Idempotency & removal
     *
     * Registering with a title that already exists replaces the previous entry. Use
     * {@link Bun.cron.remove} to unregister. The title is namespaced per user, so
     * different users can register jobs with the same title independently.
     *
     * @param path Path to the module to run. Resolved relative to the calling file.
     * @param schedule Cron expression or nickname (e.g. `"30 2 * * MON"`, `"@daily"`).
     * @param title Unique identifier for this job. Alphanumeric, hyphens, and underscores only —
     *   used directly in crontab markers, launchd service labels, and schtasks task names.
     * @returns Promise that resolves once the OS scheduler has accepted the job.
     * @throws If the cron expression is invalid, `title` contains illegal characters,
     *   the expression exceeds Windows' trigger limit, or the underlying scheduler command fails
     *   (the error message includes the scheduler's stderr output).
     *
     * @example
     * ```ts
     * // Register once (e.g. in a postinstall script or setup command)
     * await Bun.cron("./jobs/weekly-report.ts", "30 2 * * MON", "weekly-report");
     * await Bun.cron("./jobs/cleanup.ts", "@daily", "daily-cleanup");
     *
     * // Later, to unregister:
     * await Bun.cron.remove("weekly-report");
     * ```
     *
     * @see {@link Bun.cron.remove} to unregister.
     * @see {@link Bun.cron.parse} to preview the next fire time.
     */
    (path: string, schedule: CronWithAutocomplete, title: string): Promise<void>;
    /**
     * Remove a previously registered cron job by its title.
     *
     * @param title - The title of the cron job to remove
     * @returns Promise that resolves when the cron job is removed
     *
     * @example
     * ```ts
     * await Bun.cron.remove("weekly-report");
     * ```
     */
    remove(title: string): Promise<void>;
    /**
     * Parse a cron expression and return the next matching `Date` in the
     * system's local time zone — the same way crontab, launchd, and Windows
     * Task Scheduler interpret schedules. Pass `{ tz: "UTC" }` (or any IANA
     * time-zone name) to override.
     *
     * Supports the same syntax as {@link Bun.cron} — 5-field expressions, named
     * days/months, and predefined nicknames like `@daily`.
     *
     * When both day-of-month and day-of-week are specified (neither is `*`),
     * matching uses OR logic per [POSIX cron](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html):
     * a date matches if **either** field matches.
     *
     * DST: spring-forward times shift forward by the gap; in the fall-back
     * duplicated hour, fixed-time schedules fire once (first occurrence) while
     * schedules with `*` minute or hour fire through both occurrences.
     *
     * @param expression - A cron expression or nickname (e.g. `"0,15,30,45 * * * *"`, `"0 9 * * MON-FRI"`, `"@hourly"`)
     * @param relativeDate - Starting point for the search (defaults to `Date.now()`). Accepts a `Date` or milliseconds since epoch.
     * @param options - `{ tz?: string }` — IANA time-zone name to interpret the schedule in (defaults to the system's local zone).
     * @returns The next `Date` matching the expression, or `null` if no match exists within 8 years (e.g. `"0 0 30 2 *"` — Feb 30 never occurs)
     * @throws If the expression is invalid, `relativeDate` is `NaN`/`Infinity`, or `options.tz` is not a valid IANA name
     *
     * @example
     * ```ts
     * // Next weekday at 09:30 local time
     * const next = Bun.cron.parse("30 9 * * MON-FRI");
     *
     * // 09:00 in New York, regardless of the server's TZ
     * const ny = Bun.cron.parse("0 9 * * *", Date.now(), { tz: "America/New_York" });
     *
     * // Chain calls to get a sequence
     * const from = new Date();
     * const first = Bun.cron.parse("@hourly", from);
     * const second = first ? Bun.cron.parse("@hourly", first) : null;
     * ```
     */
    parse(expression: CronWithAutocomplete, relativeDate?: Date | number, options?: CronOptions): Date | null;
  };

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

  /**
   * Options for creating a pseudo-terminal (PTY).
   */
  interface TerminalOptions {
    /**
     * Number of columns for the terminal.
     * @default 80
     */
    cols?: number;
    /**
     * Number of rows for the terminal.
     * @default 24
     */
    rows?: number;
    /**
     * Terminal name (e.g., "xterm-256color").
     * @default "xterm-256color"
     */
    name?: string;
    /**
     * Callback invoked when data is received from the terminal.
     * @param terminal The terminal instance
     * @param data The data received as a Uint8Array
     */
    data?: (terminal: Terminal, data: Uint8Array<ArrayBuffer>) => void;
    /**
     * Callback invoked when the PTY stream closes (EOF or read error).
     * `exitCode` is a PTY lifecycle status (0 = clean EOF, 1 = error), NOT the subprocess exit code.
     * Use {@link Subprocess.exited} or the `onExit` callback for the process exit information.
     * @param terminal The terminal instance
     * @param exitCode PTY lifecycle status (0 for EOF, 1 for error)
     * @param signal Always `null`; reserved for future signal reporting
     */
    exit?: (terminal: Terminal, exitCode: number, signal: string | null) => void;
    /**
     * Callback invoked when the terminal is ready to receive more data.
     * @param terminal The terminal instance
     */
    drain?: (terminal: Terminal) => void;
  }

  /**
   * A pseudo-terminal (PTY) for spawning interactive terminal programs.
   *
   * @example
   * ```ts
   * await using terminal = new Bun.Terminal({
   *   cols: 80,
   *   rows: 24,
   *   data(term, data) {
   *     console.log("Received:", new TextDecoder().decode(data));
   *   },
   * });
   *
   * // Spawn a shell connected to the PTY
   * const proc = Bun.spawn(["bash"], { terminal });
   *
   * // Write to the terminal
   * terminal.write("echo hello\n");
   *
   * // Wait for process to exit
   * await proc.exited;
   *
   * // Terminal is closed automatically by `await using`
   * ```
   */
  class Terminal implements AsyncDisposable {
    constructor(options: TerminalOptions);

    /**
     * Whether the terminal is closed.
     */
    readonly closed: boolean;

    /**
     * Write data to the terminal.
     *
     * All bytes are accepted; any portion that cannot be flushed to the PTY
     * immediately is buffered and delivered later. The `drain` callback fires
     * once buffered data has been flushed. Do not re-send any part of `data`
     * based on the return value.
     *
     * @param data The data to write (string or BufferSource)
     * @returns The number of bytes accepted (the byte length of `data`)
     */
    write(data: string | BufferSource): number;

    /**
     * Resize the terminal.
     * @param cols New number of columns
     * @param rows New number of rows
     */
    resize(cols: number, rows: number): void;

    /**
     * Set raw mode on the terminal.
     * In raw mode, input is passed directly without processing.
     * @param enabled Whether to enable raw mode
     */
    setRawMode(enabled: boolean): void;

    /**
     * Reference the terminal to keep the event loop alive.
     */
    ref(): void;

    /**
     * Unreference the terminal to allow the event loop to exit.
     */
    unref(): void;

    /**
     * Close the terminal.
     */
    close(): void;

    /**
     * Async dispose for use with `await using`.
     */
    [Symbol.asyncDispose](): Promise<void>;

    /**
     * Terminal input flags (c_iflag from termios).
     * Controls input processing behavior like ICRNL, IXON, etc.
     * Returns 0 if the terminal is closed.
     * Setting returns true on success, false on failure.
     */
    inputFlags: number;

    /**
     * Terminal output flags (c_oflag from termios).
     * Controls output processing behavior like OPOST, ONLCR, etc.
     * Returns 0 if the terminal is closed.
     * Setting returns true on success, false on failure.
     */
    outputFlags: number;

    /**
     * Terminal local flags (c_lflag from termios).
     * Controls local processing like ICANON, ECHO, ISIG, etc.
     * Returns 0 if the terminal is closed.
     * Setting returns true on success, false on failure.
     */
    localFlags: number;

    /**
     * Terminal control flags (c_cflag from termios).
     * Controls hardware characteristics like CSIZE, PARENB, etc.
     * Returns 0 if the terminal is closed.
     * Setting returns true on success, false on failure.
     */
    controlFlags: number;
  }

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

  /**
   * Resolve routes against a directory of files using Next.js-style (`pages`
   * directory) conventions.
   */
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
     * @param options.style The style of router to use (only "nextjs" is supported)
     */
    constructor(options: {
      /**
       * The root directory containing the files to route
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
   * Like `readline()`, but without the IO.
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
     * Whether to traverse descendants of symbolic link directories.
     *
     * @default false
     */
    followSymlinks?: boolean;

    /**
     * Throw an error when a symbolic link is broken
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
   * The supported pattern syntax is:
   *
   * - `?`
   *     Matches any single character.
   * - `*`
   *     Matches zero or more characters, except for path separators ('/' or '\').
   * - `**`
   *     Matches zero or more characters, including path separators.
   *     Must match a complete path segment (followed by a path separator or
   *     at the end of the pattern).
   * - `[ab]`
   *     Matches one of the characters contained in the brackets.
   *     Character ranges like "[a-z]" are also supported.
   *     Use "[!ab]" or "[^ab]" to match any character *except* those contained
   *     in the brackets.
   * - `{a,b}`
   *     Match one of the patterns contained in the braces.
   *     The sub-patterns can use any of the other wildcards.
   *     Braces may be nested up to 10 levels deep.
   * - `!`
   *     Negates the result when at the start of the pattern.
   *     Multiple "!" characters negate the pattern multiple times.
   * - `\`
   *     Escapes any of the special characters listed here.
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

  namespace Image {
    /**
     * Stable `error.code` values set on rejections from `Bun.Image` terminals.
     * Branch on these instead of parsing the message.
     *
     * - `ERR_IMAGE_FORMAT_UNSUPPORTED` — the requested format isn't available
     *   on this *machine* (HEIC/AVIF without the OS codec, TIFF on Linux).
     *   Catch this to fall back to a portable format.
     * - `ERR_IMAGE_TOO_MANY_PIXELS` — header dimensions or resize output
     *   exceed `maxPixels`, or a path-backed input is over the 256 MiB cap.
     * - `ERR_IMAGE_DECODE_FAILED` / `ERR_IMAGE_ENCODE_FAILED` — codec error.
     * - `ERR_IMAGE_UNKNOWN_FORMAT` — input bytes didn't match any sniffer.
     * - `ERR_INVALID_STATE` — the input ArrayBuffer was transferred between
     *   construction and the terminal call.
     * - File-backed inputs surface the underlying syscall code (`ENOENT`,
     *   `EACCES`, …) directly.
     */
    type ErrorCode =
      | "ERR_IMAGE_FORMAT_UNSUPPORTED"
      | "ERR_IMAGE_TOO_MANY_PIXELS"
      | "ERR_IMAGE_DECODE_FAILED"
      | "ERR_IMAGE_ENCODE_FAILED"
      | "ERR_IMAGE_UNKNOWN_FORMAT"
      | "ERR_INVALID_STATE";

    /**
     * `bmp`/`tiff`/`gif` are decode-only — `metadata().format` may report them
     * but there are no `.bmp()`/`.tiff()`/`.gif()` encoder methods. `tiff`
     * decode rejects with `error.code === "ERR_IMAGE_FORMAT_UNSUPPORTED"` on Linux; `gif` decodes the first
     * frame everywhere.
     */
    type Format = "jpeg" | "png" | "webp" | "heic" | "avif" | "bmp" | "tiff" | "gif";
    type Filter =
      | "nearest"
      | "box"
      | "bilinear"
      | "linear" // alias for bilinear (Sharp)
      | "cubic"
      | "mitchell"
      | "lanczos2"
      | "lanczos3"
      | "mks2013"
      | "mks2021";

    interface ConstructorOptions {
      /**
       * Reject inputs whose `width × height` exceeds this many pixels. The
       * check runs after the header is read but before any pixel buffer is
       * allocated, so a tiny file claiming a huge canvas is refused cheaply.
       * @default 268402689 // 0x3FFF * 0x3FFF, same as Sharp
       */
      maxPixels?: number;
      /**
       * Apply EXIF Orientation (JPEG) before any other operation.
       * @default true
       */
      autoOrient?: boolean;
    }

    interface ResizeOptions {
      /** Resampling kernel. @default "lanczos3" */
      filter?: Filter;
      /**
       * `"fill"` stretches to exactly width×height. `"inside"` preserves
       * aspect ratio so the result fits *within* width×height.
       * @default "fill"
       */
      fit?: "fill" | "inside";
      /** Never upscale — if the source is already smaller, leave it. */
      withoutEnlargement?: boolean;
    }

    interface ModulateOptions {
      /** Multiplier; `1` leaves brightness unchanged. */
      brightness?: number;
      /** `0` = greyscale, `1` = unchanged, `>1` = more saturated. */
      saturation?: number;
    }

    interface Metadata {
      width: number;
      height: number;
      format: Format;
    }
  }

  /**
   * Decode, transform and re-encode images. Ships JPEG, PNG and WebP via
   * statically-linked libjpeg-turbo / libspng / libwebp; resize and rotate
   * are SIMD kernels — no native module install, no `sharp`.
   *
   * The constructor and every chainable method only *record* settings; the
   * decode → transform → encode pipeline runs on a worker thread when a
   * terminal (`bytes`, `buffer`, `blob`, `toBase64`, `metadata`) is awaited.
   *
   * Chainables overwrite (calling `.resize()` twice keeps the second). Order
   * of execution is fixed regardless of call order:
   * `autoOrient → rotate → flip/flop → resize → modulate`.
   *
   * The source ICC colour profile (Display P3, Adobe RGB, Jpegli XYB, etc.)
   * is preserved through re-encode to JPEG, PNG, and WebP so non-sRGB
   * images don't shift colour.
   *
   * @example
   * ```ts
   * const thumb = await new Bun.Image("photo.jpg")
   *   .resize(400, 400, { fit: "inside", withoutEnlargement: true })
   *   .webp({ quality: 80 })
   *   .bytes();
   * ```
   */
  export class Image {
    /**
     * Process-global pipeline backend.
     *
     * - `"system"` (default on macOS/Windows) — static codecs for
     *   JPEG/PNG/WebP (same bytes as Linux), Accelerate/vImage for `lanczos3`
     *   resize · rotate · flip on macOS, and ImageIO/WIC for HEIC/AVIF.
     * - `"bun"` — static codecs + Highway geometry only. Byte-identical to a
     *   Linux build; HEIC/AVIF reject with `ERR_IMAGE_FORMAT_UNSUPPORTED`.
     *
     * Set before awaiting a pipeline; in-flight tasks read the value as of
     * when they were scheduled.
     */
    static backend: "system" | "bun";

    /**
     * Read an image from the system clipboard.
     *
     * Returns a `Bun.Image` wrapping whatever container the clipboard holds
     * (PNG, TIFF, HEIC, JPEG, BMP, …); call {@link metadata}, {@link resize},
     * etc. as usual. `null` if no image is present.
     *
     * - **macOS**: NSPasteboard
     * - **Windows**: registered `"PNG"` / `CF_DIBV5` / `CF_DIB`
     * - **Linux**: always `null` (use `wl-paste`/`xclip` and pass the bytes
     *   to `new Bun.Image(...)`)
     */
    static fromClipboard(): Image | null;
    /** Cheap probe — true if {@link fromClipboard} would return non-null. */
    static hasClipboardImage(): boolean;
    /**
     * Monotone counter that increments on every system-wide clipboard write.
     * Poll this and only call {@link hasClipboardImage} when it moves. `-1`
     * on Linux.
     */
    static clipboardChangeCount(): number;

    constructor(input: string | ArrayBuffer | NodeJS.TypedArray | Blob, options?: Image.ConstructorOptions);

    /** Set target dimensions. Omit `height` to keep the source aspect ratio. */
    resize(width: number, height?: number, options?: Image.ResizeOptions): this;
    /** Rotate by a multiple of 90°. */
    rotate(degrees: number): this;
    /** Mirror about the x-axis (vertical). */
    flip(): this;
    /** Mirror about the y-axis (horizontal). */
    flop(): this;
    /** Adjust brightness/saturation. */
    modulate(options: Image.ModulateOptions): this;

    /** Set output format to JPEG. */
    jpeg(options?: {
      /** 1–100, default 80. */
      quality?: number;
      /** Emit a progressive (multi-scan) JPEG. Default `false`. */
      progressive?: boolean;
    }): this;
    /** Set output format to PNG. */
    png(options?: {
      /** zlib level 0–9. */
      compressionLevel?: number;
      /** Quantize to a palette and emit indexed (colour-type 3) PNG. */
      palette?: boolean;
      /** Max palette size when `palette: true`. 2–256. @default 256 */
      colors?: number;
      /** Floyd–Steinberg error-diffusion dither (only with `palette: true`). */
      dither?: boolean;
    }): this;
    /** Set output format to WebP. */
    webp(options?: { quality?: number; lossless?: boolean }): this;
    /**
     * Set output format to HEIC. macOS / Windows-with-HEIF-Extension only —
     * the terminal rejects with `error.code === "ERR_IMAGE_FORMAT_UNSUPPORTED"`
     * elsewhere.
     */
    heic(options?: { quality?: number }): this;
    /**
     * Set output format to AVIF. Requires an OS AV1 encoder (macOS on Apple
     * Silicon M3+, or Windows with the AV1 Video Extension) — the terminal
     * rejects with `error.code === "ERR_IMAGE_FORMAT_UNSUPPORTED"` elsewhere.
     */
    avif(options?: { quality?: number }): this;

    /**
     * Run the pipeline and return the encoded bytes. If no format setter was
     * called, re-encodes in the source format.
     */
    bytes(): Promise<Uint8Array>;
    /** Like {@link bytes} but as a Node `Buffer`. */
    buffer(): Promise<Buffer>;
    /** Sharp-compatible alias for {@link buffer}. */
    toBuffer(): Promise<Buffer>;
    /**
     * Run the pipeline and write the encoded result via {@link Bun.write} —
     * `dest` may be a path string, {@link BunFile}, {@link S3File}, or fd.
     * Resolves to the number of bytes written.
     *
     * If no format method was chained and `dest` is a path string, the format
     * is inferred from its extension when it's one Bun can encode
     * (`.jpg`/`.png`/`.webp`/`.heic`/`.avif`); otherwise the source format is
     * reused.
     */
    write(dest: BunFile | S3File | Bun.PathLike | number): Promise<number>;
    /**
     * Like {@link toBase64} with a `data:image/{format};base64,` prefix.
     * Drops straight into `<img src>`.
     */
    dataurl(): Promise<string>;
    /**
     * A [ThumbHash](https://github.com/evanw/thumbhash)-rendered low-quality
     * placeholder of the *source* image as a `data:image/png;base64,…` URL —
     * a ≤32px blur with the right average colour, aspect ratio and rough
     * structure, ~400–700 bytes. Ready for `<img src>` or Next's
     * `blurDataURL`; no client-side decoder needed.
     *
     * ```ts
     * const lqip = await Bun.file("hero.jpg").image().placeholder();
     * // "data:image/png;base64,iVBORw0KGgoAAAANSUhE…"
     * ```
     */
    placeholder(as?: "dataurl"): Promise<string>;
    /** Run the pipeline and return a `Blob` with the matching `type`. */
    blob(): Promise<Blob>;
    /** Run the pipeline and return base64-encoded output. */
    toBase64(): Promise<string>;
    /** Decode just enough to read width/height/format. */
    metadata(): Promise<Image.Metadata>;

    /** Populated after the first awaited terminal; `-1` before. */
    readonly width: number;
    /** Populated after the first awaited terminal; `-1` before. */
    readonly height: number;
  }

  namespace WebView {
    type Modifier = "Shift" | "Control" | "Alt" | "Meta";

    type VirtualKey =
      | "Enter"
      | "Tab"
      | "Space"
      | "Backspace"
      | "Delete"
      | "Escape"
      | "ArrowLeft"
      | "ArrowRight"
      | "ArrowUp"
      | "ArrowDown"
      | "Home"
      | "End"
      | "PageUp"
      | "PageDown";

    interface ClickOptions {
      /** @default "left" */
      button?: "left" | "right" | "middle";
      /** Modifier keys to hold during the click. */
      modifiers?: Modifier[];
      /** Number of clicks (1 = single, 2 = double, 3 = triple). @default 1 */
      clickCount?: 1 | 2 | 3;
    }

    interface ClickSelectorOptions extends ClickOptions {
      /**
       * Maximum time in milliseconds to wait for the element to become
       * actionable (attached, visible, stable for 2 frames, not obscured).
       * @default 30000
       */
      timeout?: number;
    }

    interface ScrollToOptions {
      /**
       * Maximum time in milliseconds to wait for the element to exist.
       * @default 30000
       */
      timeout?: number;
      /**
       * Vertical alignment. `"nearest"` scrolls minimally (no-op if already
       * in view); `"center"` snaps the element's center to the viewport
       * center.
       * @default "center"
       */
      block?: "start" | "center" | "end" | "nearest";
    }

    interface PressOptions {
      /** Modifier keys to hold during the keypress. */
      modifiers?: Modifier[];
    }

    /**
     * Browser backend selection.
     *
     * - `"webkit"` (default): WKWebView. macOS only. Zero external
     *   dependencies — uses the system WebKit.framework.
     * - `"chrome"`: Chrome/Chromium via DevTools Protocol over
     *   `--remote-debugging-pipe`. Works anywhere Chrome is installed.
     *   Auto-detects the binary in standard locations; override with
     *   `backend.path` or the `BUN_CHROME_PATH` environment variable.
     *
     * The object form accepts extra launch flags. Chrome switches are
     * last-wins for duplicates, so `argv` can override the defaults.
     *
     * **Chrome is spawned once per process** — the first `new Bun.WebView()`
     * call's `path`/`argv`/`dataStore.directory` win; subsequent views reuse
     * the same Chrome instance via `Target.createTarget`.
     *
     * Default flags: `--remote-debugging-pipe --headless --no-first-run
     * --no-default-browser-check --disable-gpu --user-data-dir=<temp>`.
     */
    type Backend =
      | "webkit"
      | "chrome"
      | {
          type: "chrome";
          /**
           * Connect to an existing Chrome's DevTools WebSocket directly.
           * Get the URL from Chrome's `DevToolsActivePort` file
           * (`<port>\n<path>`, in the profile directory) — the full URL
           * is `ws://127.0.0.1:<port><path>`.
           *
           * Enable remote debugging in Chrome at
           * `chrome://inspect/#remote-debugging`, or launch with
           * `--remote-debugging-port=9222`. Both write
           * `DevToolsActivePort`.
           *
           * **Note**: The `chrome://inspect` toggle shows an "Allow
           * remote debugging?" dialog on **every** new connection.
           *
           * Mutually exclusive with `path`/`argv` — you're connecting
           * to a Chrome that's already running, not spawning one.
           */
          url: string;
        }
      | {
          type: "chrome";
          /**
           * Controls the connect-vs-spawn choice:
           *
           * - `false` — skip auto-detect, always spawn a fresh Chrome.
           *   Executable path still auto-found unless `path` is set.
           * - `undefined` (default) — **auto-detect**: if a
           *   `DevToolsActivePort` file exists (Chrome with remote
           *   debugging is running), connect to it; else spawn.
           *
           * Auto-detect falls back to spawn if the connect fails (stale
           * file from a dead Chrome). The WebSocket auto-closes when
           * the last `WebView` is closed. For unattended automation,
           * pass `url: false`.
           */
          url?: false;
          /**
           * Path to the Chrome/Chromium executable. Overrides
           * auto-detection and forces Bun to spawn a fresh Chrome
           * subprocess (skipping the existing-Chrome auto-connect).
           *
           * **Auto-connect**: when neither `path` nor `url` is set, Bun
           * checks Chrome's `DevToolsActivePort` file — if a Chrome with
           * remote debugging is already running, Bun connects to it over
           * WebSocket instead of spawning. Pass `path` (or `argv`) to
           * force spawn-mode.
           */
          path?: string;
          /**
           * Extra command-line arguments appended after the default flags.
           * Chrome's CommandLine does last-wins for duplicate switches, so
           * `["--headless=new"]` would override the default `--headless`.
           */
          argv?: string[];
          /**
           * Route the subprocess's stdout to Bun's. Chrome is mostly quiet
           * here. @default "ignore"
           */
          stdout?: "inherit" | "ignore";
          /**
           * Route the subprocess's stderr to Bun's. Chrome is chatty (GCM
           * registration, updater noise, font-config warnings) even with a
           * minimal flag set. Set to `"inherit"` when Chrome crashes silently
           * — the crash report lands here. @default "ignore"
           */
          stderr?: "inherit" | "ignore";
        }
      | {
          type: "webkit";
          /**
           * Route the host process's stdout to Bun's. The host runs no JS
           * — only panic/NSLog output. @default "ignore"
           */
          stdout?: "inherit" | "ignore";
          /**
           * Route the host process's stderr to Bun's. @default "ignore"
           */
          stderr?: "inherit" | "ignore";
        };

    /**
     * Console capture. Called for each `console.*` invocation in the page.
     *
     * - `globalThis.console`: forward directly to the parent's console.
     *   `console.log("hi")` in the page prints `hi` to stdout with Bun's
     *   formatter; `console.error` goes to stderr. Zero JS overhead per call
     *   — dispatches through `ConsoleClient` directly.
     * - `(type, ...args) => void`: custom callback. `type` is the method
     *   name (`"log"` | `"warn"` | `"error"` | `"info"` | `"debug"` | ...).
     *   Primitive args unwrap to their raw values; object args arrive as a
     *   structured descriptor — for Chrome, the CDP `RemoteObject` with
     *   `.type`/`.className`/`.description`/`.preview.properties`; for
     *   WebKit, the JSON round-trip of the object (lossy for functions/
     *   circular refs, which stringify to their `String(...)` coercion).
     */
    type ConsoleCapture = typeof console | ((type: string, ...args: unknown[]) => void);

    interface ConstructorOptions {
      /** Viewport width in pixels. Range: [1, 16384]. @default 800 */
      width?: number;
      /** Viewport height in pixels. Range: [1, 16384]. @default 600 */
      height?: number;
      /** Only `true` (headless) is implemented. @default true */
      headless?: boolean;
      /**
       * Browser backend. Defaults to `"webkit"` on macOS, throws on other
       * platforms unless `"chrome"` is specified.
       * @default "webkit"
       */
      backend?: Backend;
      /**
       * Initial URL to navigate to. The navigation starts before the
       * constructor returns; `await view.navigate(otherUrl)` or any other
       * operation waits for it to complete first.
       *
       * Equivalent to calling `view.navigate(url)` immediately after
       * construction.
       */
      url?: string;
      /** Capture page-side `console.*` calls. See {@link ConsoleCapture}. */
      console?: ConsoleCapture;
      /**
       * Storage backing for cookies, localStorage, IndexedDB, etc.
       *
       * - `"ephemeral"` (default): in-memory only, nothing written to disk.
       * - `{ directory }`: persistent storage rooted at the given path.
       *   Multiple views with the same directory share state.
       *
       * **Chrome backend**: `directory` is per-Chrome-process
       * (`--user-data-dir`), not per-view. The first view's directory
       * applies to all views spawned in the same Bun process.
       */
      dataStore?: "ephemeral" | { directory: string };
    }
  }

  /**
   * A headless browser view for automation. WKWebView on macOS (zero
   * dependencies), Chrome DevTools Protocol elsewhere (or with
   * `backend: "chrome"`).
   *
   * Each view runs its page in a separate renderer process. All input
   * methods dispatch **native** events — the resulting DOM events have
   * `isTrusted: true`.
   *
   * @example
   * ```ts
   * await using view = new Bun.WebView({ width: 800, height: 600 });
   * await view.navigate("https://example.com");
   * await view.click("button[type=submit]");  // waits for actionability
   * const title = await view.evaluate("document.title");
   * const png = await view.screenshot();
   * ```
   *
   * @example
   * ```ts
   * // Forward page console.log to parent stdout
   * const view = new Bun.WebView({
   *   backend: "chrome",
   *   console: globalThis.console,
   * });
   * ```
   *
   * @experimental
   */
  class WebView extends EventTarget {
    /**
     * @throws on non-macOS platforms when `backend` is `"webkit"` (the
     * default). Pass `backend: "chrome"` for cross-platform support.
     */
    constructor(options?: WebView.ConstructorOptions);

    /**
     * Force-kill all browser subprocesses (Chrome and the WKWebView host).
     * Pending promises on all views reject on the next event loop tick.
     *
     * Called automatically at process exit. Call manually to reclaim browser
     * resources early — subsequent `new Bun.WebView()` calls respawn them.
     * Idempotent: calling when no subprocesses are alive is a no-op.
     */
    static closeAll(): void;

    /** The last-navigated URL. Updated when a navigation completes. */
    readonly url: string;
    /** The page's `<title>`. Updated when a navigation completes. */
    readonly title: string;
    /** True while a navigation is in flight. */
    readonly loading: boolean;

    /**
     * Fired when a navigation completes successfully. The callback runs
     * before the corresponding `navigate()` promise resolves.
     */
    onNavigated: ((url: string, title: string) => void) | null;
    /**
     * Fired when a navigation fails. The callback runs before the
     * corresponding `navigate()` promise rejects.
     */
    onNavigationFailed: ((error: Error) => void) | null;

    /**
     * Navigate to a URL. Resolves when the main frame's load completes
     * (WKNavigationDelegate `didFinishNavigation`).
     *
     * @example
     * ```ts
     * await view.navigate("https://example.com");
     * await view.navigate("data:text/html,<h1>hello</h1>");
     * ```
     */
    navigate(url: string): Promise<void>;

    /**
     * Run a JavaScript expression in the page's main frame and return the
     * result as a native JS value.
     *
     * The expression is wrapped as `await (${script})` — if it evaluates
     * to a Promise, the promise is awaited. The resolved value is
     * serialized page-side via `JSON.stringify` and deserialized here, so
     * arrays and objects come back as real structures:
     *
     * ```ts
     * await view.evaluate("document.title");        // string
     * await view.evaluate("[1, 2, 3]");              // number[]
     * await view.evaluate("({ a: 1, b: true })");    // { a: number, b: boolean }
     * await view.evaluate("fetch('/api').then(r => r.json())");  // awaited
     * ```
     *
     * **`script` must be an expression.** For statement sequences, wrap in
     * an IIFE: `evaluate("(() => { let x = f(); return x + 1 })()")`.
     *
     * Values that `JSON.stringify` collapses to `undefined` (functions,
     * symbols, `undefined` itself) resolve to `undefined`. Circular
     * references reject.
     *
     * Only one `evaluate()` may be in flight at a time per view; a second
     * concurrent call throws `ERR_INVALID_STATE`.
     */
    evaluate<T = unknown>(script: string): Promise<T>;

    /**
     * Capture a screenshot of the current viewport.
     *
     * **`encoding` controls the return type:**
     * - `"blob"` (default) — `Blob` with the right MIME type. WebKit:
     *   zero-copy mmap-backed store. Composes with `Bun.write()`,
     *   `new Response()`, `blob.bytes()`.
     * - `"buffer"` — Node `Buffer`. WebKit: zero-copy (the same mmap'd
     *   pages wrapped as an `ArrayBuffer` that munmap's on GC).
     * - `"base64"` — base64-encoded `string`. Chrome: zero decode (CDP
     *   returns base64 natively). Direct Kitty `t=d` transmission.
     * - `"shmem"` — `{ name, size }`. The POSIX shm name is left linked;
     *   caller owns `shm_unlink`. Kitty `t=s` transmission: pass `name`
     *   as the payload, Kitty unlinks after reading. Not on Windows.
     *
     * @param options.format Image format. `"webp"` requires Chrome.
     *   @default `"png"`
     * @param options.quality Compression quality for JPEG/WebP, 0-100.
     *   Ignored for PNG. @default `80`
     * @param options.encoding Return-type encoding. @default `"blob"`
     *
     * @example Kitty graphics protocol, shared-memory transmission
     * ```ts
     * const { name, size } = await view.screenshot({ encoding: "shmem" });
     * process.stdout.write(
     *   `\x1b_Gf=100,t=s,a=T,S=${size};${btoa(name)}\x1b\\`
     * );
     * // Kitty shm_open's the name, reads ${size} PNG bytes, unlinks.
     * ```
     */
    screenshot(options?: { encoding?: "blob"; format?: "png" | "jpeg" | "webp"; quality?: number }): Promise<Blob>;
    screenshot(options: { encoding: "buffer"; format?: "png" | "jpeg" | "webp"; quality?: number }): Promise<Buffer>;
    screenshot(options: { encoding: "base64"; format?: "png" | "jpeg" | "webp"; quality?: number }): Promise<string>;
    screenshot(options: { encoding: "shmem"; format?: "png" | "jpeg" | "webp"; quality?: number }): Promise<{
      /** POSIX shm name (pass to `shm_open(2)` or Kitty `t=s`). */
      name: string;
      /** Encoded image size in bytes. */
      size: number;
    }>;

    /**
     * Send a raw Chrome DevTools Protocol command. **Chrome backend only.**
     *
     * The command is scoped to this view's session (targets the current
     * tab). Returns the decoded `result` object from the CDP response, or
     * rejects with the `error.message` if Chrome reports a protocol error.
     *
     * Call `await view.navigate(...)` at least once before using `cdp()` —
     * the first navigate sets up the CDP session.
     *
     * @param method Domain-qualified method name, e.g.
     *   `"Runtime.evaluate"`, `"DOM.querySelector"`,
     *   `"Emulation.setUserAgentOverride"`.
     * @param params Command parameters. Must be JSON-serializable.
     *
     * @example
     * ```ts
     * const view = new Bun.WebView({ backend: "chrome" });
     * await view.navigate("https://example.com");
     *
     * const { root } = await view.cdp("DOM.getDocument");
     * const { nodeId } = await view.cdp("DOM.querySelector", {
     *   nodeId: root.nodeId,
     *   selector: "input#search",
     * });
     * await view.cdp("DOM.focus", { nodeId });
     * ```
     *
     * @see https://chromedevtools.github.io/devtools-protocol/
     */
    cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

    /**
     * Subscribe to CDP events. **Chrome backend only.**
     *
     * Event types are CDP method names directly —
     * `"Network.responseReceived"`, `"Page.frameStartedLoading"`,
     * `"DOM.documentUpdated"`, etc. The listener receives a
     * `MessageEvent` with the CDP params as `event.data`.
     *
     * Enable the domain first with `cdp("Domain.enable")`, or Chrome
     * won't send those events. Events without a registered listener
     * are dropped before JSON parsing (no overhead for domains you
     * enabled but don't fully listen to).
     *
     * @example
     * ```ts
     * await view.navigate("about:blank");
     * await view.cdp("Network.enable");
     * view.addEventListener("Network.responseReceived", e => {
     *   console.log(e.data.response.status, e.data.response.url);
     * });
     * await view.navigate("https://example.com");
     * ```
     */
    addEventListener<T = unknown>(
      type: `${string}.${string}`,
      listener: (event: MessageEvent<T>) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;

    /**
     * Click at the given viewport coordinates.
     *
     * Fires native `pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click`
     * events with `isTrusted: true`. The promise resolves after WebContent
     * has processed the full event sequence (including all JS handlers) —
     * no polling, WebKit's own mouse-queue-drain barrier.
     */
    click(x: number, y: number, options?: WebView.ClickOptions): Promise<void>;
    /**
     * Wait for an element to become actionable, then click its center.
     *
     * Actionability is checked page-side at rAF rate: the element must be
     * attached, have non-zero size, be in the viewport, be stable (bounding
     * box unchanged for 2 consecutive frames), and be the topmost element
     * at its center point (not obscured). Once actionable, a native click
     * fires at the center coordinates.
     *
     * @example
     * ```ts
     * // Waits for the button to appear and stop animating, then clicks.
     * await view.click("#submit");
     * ```
     */
    click(selector: string, options?: WebView.ClickSelectorOptions): Promise<void>;

    /**
     * Insert text into the focused element.
     *
     * Uses WebKit's `InsertText` editing command (not keystroke simulation),
     * so no `keydown` events fire — this is the same path as paste. No IME,
     * no smart-quote substitution; the text lands exactly as given. Fires
     * `beforeinput`/`input` with `isTrusted: true`.
     */
    type(text: string): Promise<void>;

    /**
     * Press a key.
     *
     * Named keys (`"Enter"`, `"Backspace"`, `"ArrowLeft"`, etc.) map to
     * editing commands where available and resolve when WebContent has
     * processed them. `"Escape"` and keys with modifiers fall back to raw
     * keyDown/keyUp (no WebKit barrier exists for keyboard events — a
     * following `evaluate()` serializes).
     *
     * A single character (e.g. `"a"`) combined with `modifiers` sends a
     * chord like Cmd+A.
     */
    press(key: WebView.VirtualKey | (string & {}), options?: WebView.PressOptions): Promise<void>;

    /**
     * Scroll the viewport by the given pixel delta.
     *
     * Fires a native `wheel` event with `isTrusted: true` at the viewport
     * center. Positive `dy` scrolls down (content up), matching
     * `window.scrollBy` semantics.
     */
    scroll(dx: number, dy: number): Promise<void>;

    /**
     * Wait for an element to exist, then scroll it into view.
     *
     * Uses `Element.scrollIntoView({ block, behavior: 'instant' })` —
     * scrolls every scrollable ancestor in the chain, not just the
     * document. `scrollY` is updated synchronously before the promise
     * resolves. No `wheel` event fires (this is a programmatic scroll).
     *
     * @example
     * ```ts
     * await view.scrollTo("#footer");               // center (default)
     * await view.scrollTo("#hero", { block: "start" });
     * await view.scrollTo(".item", { block: "nearest" }); // minimal scroll
     * ```
     */
    scrollTo(selector: string, options?: WebView.ScrollToOptions): Promise<void>;

    /**
     * Resize the viewport.
     */
    resize(width: number, height: number): Promise<void>;

    /** Navigate back in session history. */
    back(): Promise<void>;
    /** Navigate forward in session history. */
    forward(): Promise<void>;
    /** Reload the current page. */
    reload(): Promise<void>;

    /**
     * Close the view and release its WebContent process. After close,
     * all methods throw. Idempotent.
     */
    close(): void;

    /** Alias for {@link close}. Enables `using view = new Bun.WebView(...)`. */
    [Symbol.dispose](): void;
    /** Alias for {@link close}. Enables `await using view = new Bun.WebView(...)`. */
    [Symbol.asyncDispose](): void;
  }

  /**
   * Input data for creating an archive. Can be:
   * - An object mapping paths to file contents (string, Blob, TypedArray, or ArrayBuffer)
   * - A Blob containing existing archive data
   * - A TypedArray or ArrayBuffer containing existing archive data
   */
  type ArchiveInput = Record<string, BlobPart> | Blob | ArrayBufferView | ArrayBufferLike;

  /**
   * Compression format for archive output.
   * Only `"gzip"` is supported.
   */
  type ArchiveCompression = "gzip";

  /**
   * Options for creating an Archive instance.
   *
   * By default, archives are not compressed. Use `{ compress: "gzip" }` to enable compression.
   *
   * @example
   * ```ts
   * // No compression (default)
   * new Bun.Archive(data);
   *
   * // Enable gzip with default level (6)
   * new Bun.Archive(data, { compress: "gzip" });
   *
   * // Specify compression level
   * new Bun.Archive(data, { compress: "gzip", level: 9 });
   * ```
   */
  interface ArchiveOptions {
    /**
     * Compression algorithm to use.
     * Only `"gzip"` is supported.
     * If not specified, no compression is applied.
     */
    compress?: ArchiveCompression;
    /**
     * Compression level (1-12). Only applies when `compress` is set.
     * - 1: Fastest compression, lowest ratio
     * - 6: Default balance of speed and ratio
     * - 12: Best compression ratio, slowest
     *
     * @default 6
     */
    level?: number;
  }

  /**
   * Options for extracting archive contents.
   */
  interface ArchiveExtractOptions {
    /**
     * Glob pattern(s) to filter which entries are extracted.
     * Uses the same syntax as {@link Bun.Glob}, including support for wildcards (`*`, `**`),
     * character classes (`[abc]`), alternation (`{a,b}`), and negation (`!pattern`).
     *
     * Patterns are matched against archive entry paths normalized to use forward slashes (`/`),
     * regardless of the host operating system. Always write patterns using `/` as the separator.
     *
     * - Positive patterns: Only entries matching at least one pattern are extracted.
     * - Negative patterns (prefixed with `!`): Entries matching these patterns are excluded.
     *   Negative patterns are applied after positive patterns.
     *
     * If not specified, all entries are extracted.
     *
     * @example
     * ```ts
     * // Extract only TypeScript files
     * await archive.extract("./out", { glob: "**" + "/*.ts" });
     *
     * // Extract files from multiple directories
     * await archive.extract("./out", { glob: ["src/**", "lib/**"] });
     *
     * // Exclude node_modules using negative pattern
     * await archive.extract("./out", { glob: ["**", "!node_modules/**"] });
     *
     * // Extract source files but exclude tests
     * await archive.extract("./out", { glob: ["src/**", "!**" + "/*.test.ts"] });
     * ```
     */
    glob?: string | readonly string[];
  }

  /**
   * Create and extract tar archives, with optional gzip compression.
   *
   * `Bun.Archive` builds an archive from in-memory data, or wraps an existing
   * archive so you can extract it to disk or memory.
   *
   * @example
   * **Create an archive from an object:**
   * ```ts
   * const archive = new Bun.Archive({
   *   "hello.txt": "Hello, World!",
   *   "data.json": JSON.stringify({ foo: "bar" }),
   *   "binary.bin": new Uint8Array([1, 2, 3, 4]),
   * });
   * ```
   *
   * @example
   * **Create a gzipped archive:**
   * ```ts
   * const archive = new Bun.Archive({
   *   "hello.txt": "Hello, World!",
   * }, { compress: "gzip" });
   *
   * // Or with a specific compression level (1-12)
   * const archive = new Bun.Archive(data, { compress: "gzip", level: 9 });
   * ```
   *
   * @example
   * **Extract an archive to disk:**
   * ```ts
   * const archive = new Bun.Archive(tarballBytes);
   * const entryCount = await archive.extract("./output");
   * console.log(`Extracted ${entryCount} entries`);
   * ```
   *
   * @example
   * **Get archive contents as a Map of File objects:**
   * ```ts
   * const archive = new Bun.Archive(tarballBytes);
   * const entries = await archive.files();
   * for (const [path, file] of entries) {
   *   console.log(path, await file.text());
   * }
   * ```
   *
   * @example
   * **Write a gzipped archive directly to disk:**
   * ```ts
   * await Bun.Archive.write("bundle.tar.gz", {
   *   "src/index.ts": sourceCode,
   *   "package.json": packageJson,
   * }, { compress: "gzip" });
   * ```
   */
  export class Archive {
    /**
     * Create an `Archive` instance from input data.
     *
     * By default, archives are not compressed. Use `{ compress: "gzip" }` to enable compression.
     *
     * @param data - The input data for the archive:
     *   - **Object**: Creates a new tarball with the object's keys as file paths and values as file contents
     *   - **Blob/TypedArray/ArrayBuffer**: Wraps existing archive data (tar or tar.gz)
     * @param options - Archive options, including compression settings
     *
     * @example
     * **From an object (creates uncompressed tarball):**
     * ```ts
     * const archive = new Bun.Archive({
     *   "hello.txt": "Hello, World!",
     *   "nested/file.txt": "Nested content",
     * });
     * ```
     *
     * @example
     * **With gzip compression:**
     * ```ts
     * const archive = new Bun.Archive(data, { compress: "gzip" });
     * ```
     *
     * @example
     * **With explicit gzip compression level:**
     * ```ts
     * const archive = new Bun.Archive(data, { compress: "gzip", level: 12 });
     * ```
     *
     * @example
     * **From existing archive data:**
     * ```ts
     * const response = await fetch("https://example.com/package.tar.gz");
     * const archive = new Bun.Archive(await response.blob());
     * ```
     */
    constructor(data: ArchiveInput, options?: ArchiveOptions);

    /**
     * Create an archive and write it to disk in one operation.
     *
     * The data streams directly to disk, which is more efficient than creating an
     * archive and then writing it separately.
     *
     * @param path - The file path to write the archive to
     * @param data - The input data for the archive (same as `new Archive()`)
     * @param options - Optional archive options including compression settings
     *
     * @returns A promise that resolves when the write is complete
     *
     * @example
     * **Write uncompressed tarball:**
     * ```ts
     * await Bun.Archive.write("output.tar", {
     *   "file1.txt": "content1",
     *   "file2.txt": "content2",
     * });
     * ```
     *
     * @example
     * **Write gzipped tarball:**
     * ```ts
     * await Bun.Archive.write("output.tar.gz", files, { compress: "gzip" });
     * ```
     */
    static write(path: string, data: ArchiveInput | Archive, options?: ArchiveOptions): Promise<void>;

    /**
     * Extract the archive contents to a directory on disk.
     *
     * Creates the target directory and any necessary parent directories if they don't exist.
     * Existing files are overwritten.
     *
     * @param path - The directory path to extract to
     * @param options - Optional extraction options
     * @param options.glob - Glob pattern(s) to filter entries (positive patterns include, negative patterns starting with `!` exclude)
     * @returns A promise that resolves with the number of entries extracted (files, directories, and symlinks)
     *
     * @example
     * **Extract all entries:**
     * ```ts
     * const archive = new Bun.Archive(tarballBytes);
     * const count = await archive.extract("./extracted");
     * console.log(`Extracted ${count} entries`);
     * ```
     *
     * @example
     * **Extract only TypeScript files:**
     * ```ts
     * const count = await archive.extract("./src", { glob: "**" + "/*.ts" });
     * ```
     *
     * @example
     * **Extract everything except tests:**
     * ```ts
     * const count = await archive.extract("./dist", { glob: ["**", "!**" + "/*.test.*"] });
     * ```
     *
     * @example
     * **Extract source files but exclude tests:**
     * ```ts
     * const count = await archive.extract("./output", {
     *   glob: ["src/**", "lib/**", "!**" + "/*.test.ts", "!**" + "/__tests__/**"]
     * });
     * ```
     */
    extract(path: string, options?: ArchiveExtractOptions): Promise<number>;

    /**
     * Get the archive contents as a `Blob`.
     *
     * Uses the compression settings specified when the Archive was created.
     *
     * @returns A promise that resolves with the archive data as a Blob
     *
     * @example
     * **Get tarball as Blob:**
     * ```ts
     * const archive = new Bun.Archive(data);
     * const blob = await archive.blob();
     * ```
     *
     * @example
     * **Get gzipped tarball as Blob:**
     * ```ts
     * const archive = new Bun.Archive(data, { compress: "gzip" });
     * const gzippedBlob = await archive.blob();
     * ```
     */
    blob(): Promise<Blob>;

    /**
     * Get the archive contents as a `Uint8Array`.
     *
     * Uses the compression settings specified when the Archive was created.
     *
     * @returns A promise that resolves with the archive data as a Uint8Array
     *
     * @example
     * **Get tarball bytes:**
     * ```ts
     * const archive = new Bun.Archive(data);
     * const bytes = await archive.bytes();
     * ```
     *
     * @example
     * **Get gzipped tarball bytes:**
     * ```ts
     * const archive = new Bun.Archive(data, { compress: "gzip" });
     * const gzippedBytes = await archive.bytes();
     * ```
     */
    bytes(): Promise<Uint8Array<ArrayBuffer>>;

    /**
     * Get the archive contents as a `Map` of `File` objects.
     *
     * Each file in the archive is returned as a `File` object with:
     * - `name`: The file path within the archive
     * - `lastModified`: The file's modification time from the archive
     * - Standard Blob methods (`text()`, `arrayBuffer()`, `stream()`, etc.)
     *
     * Only regular files are included; directories are not returned.
     * File contents are loaded into memory, so for large archives consider using `extract()` instead.
     *
     * @param glob - Optional glob pattern(s) to filter files. Supports the same syntax as {@link Bun.Glob},
     *   including negation patterns (prefixed with `!`). Patterns are matched against paths normalized
     *   to use forward slashes (`/`).
     * @returns A promise that resolves with a Map where keys are file paths (always using forward slashes `/` as separators) and values are File objects
     *
     * @example
     * **Get all files:**
     * ```ts
     * const entries = await archive.files();
     * for (const [path, file] of entries) {
     *   console.log(`${path}: ${file.size} bytes`);
     * }
     * ```
     *
     * @example
     * **Filter by glob pattern:**
     * ```ts
     * const tsFiles = await archive.files("**" + "/*.ts");
     * const srcFiles = await archive.files(["src/**", "lib/**"]);
     * ```
     *
     * @example
     * **Exclude files with negative patterns:**
     * ```ts
     * // Get all source files except tests
     * const srcFiles = await archive.files(["src/**", "!**" + "/*.test.ts"]);
     * ```
     *
     * @example
     * **Read file contents:**
     * ```ts
     * const entries = await archive.files();
     * const readme = entries.get("README.md");
     * if (readme) {
     *   console.log(await readme.text());
     * }
     * ```
     */
    files(glob?: string | readonly string[]): Promise<Map<string, File>>;
  }

  /**
   * Generate a UUIDv7, a sequential ID based on the current timestamp with a random component.
   *
   * When the same timestamp is used multiple times, a monotonically increasing
   * counter is appended to allow sorting. The final 8 bytes are
   * cryptographically random. When the timestamp changes, the counter resets to
   * a pseudo-random integer.
   *
   * @param encoding Output encoding for the UUID
   * @param timestamp Unix timestamp in milliseconds, defaults to `Date.now()`
   *
   * @example
   * ```js
   * import { randomUUIDv7 } from "bun";
   * const array = [
   *   randomUUIDv7(),
   *   randomUUIDv7(),
   *   randomUUIDv7(),
   * ];
   * // [
   * //   "0192ce07-8c4f-7d66-afec-2482b5c9b03c",
   * //   "0192ce07-8c4f-7d67-805f-0f71581b5622",
   * //   "0192ce07-8c4f-7d68-8170-6816e4451a58"
   * // ]
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
   * Generate a UUIDv7 as a `Buffer`.
   *
   * @param encoding Pass `"buffer"` to get the UUID as bytes instead of a string
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
   * Generate a UUIDv5, a name-based UUID derived from the SHA-1 hash of a namespace UUID and a name.
   *
   * @param name The name to hash
   * @param namespace A namespace UUID, or one of the predefined namespaces `"dns"`, `"url"`, `"oid"`, or `"x500"`
   * @param encoding Output encoding for the UUID
   *
   * @example
   * ```js
   * import { randomUUIDv5 } from "bun";
   * const uuid = randomUUIDv5("www.example.com", "dns");
   * console.log(uuid); // "2ed6657d-e927-568b-95e1-2665a8aea6a2"
   * ```
   *
   * ```js
   * import { randomUUIDv5 } from "bun";
   * const uuid = randomUUIDv5("www.example.com", "url");
   * console.log(uuid); // "b63cdfa4-3df9-568e-97ae-006c5b8fd652"
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
   * Generate a UUIDv5 as a `Buffer`.
   *
   * @param name The name to hash
   * @param namespace A namespace UUID, or one of the predefined namespaces `"dns"`, `"url"`, `"oid"`, or `"x500"`
   * @param encoding Pass `"buffer"` to get the UUID as bytes instead of a string
   *
   * @example
   * ```js
   * import { randomUUIDv5 } from "bun";
   * const uuid = randomUUIDv5("www.example.com", "url", "buffer");
   * console.log(uuid); // <Buffer b6 3c df a4 3d f9 56 8e 97 ae 00 6c 5b 8f d6 52>
   * ```
   */
  function randomUUIDv5(
    name: string | BufferSource,
    namespace: string | BufferSource | "dns" | "url" | "oid" | "x500",
    encoding: "buffer",
  ): Buffer;

  /**
   * The structure of Bun's lockfile, `bun.lock`
   */
  type BunLockFile = {
    lockfileVersion: 0 | 1 | 2;
    workspaces: {
      [workspace: string]: BunLockFileWorkspacePackage;
    };
    /** @see https://bun.com/docs/install/overrides */
    overrides?: Record<string, string>;
    /** @see https://bun.com/docs/install/patch */
    patchedDependencies?: Record<string, string>;
    /** @see https://bun.com/docs/install/lifecycle#trusteddependencies */
    trustedDependencies?: string[];
    /** @see https://bun.com/docs/install/catalogs */
    catalog?: Record<string, string>;
    /** @see https://bun.com/docs/install/catalogs */
    catalogs?: Record<string, Record<string, string>>;

    /**
     * `0` / `undefined` for projects created before v1.3.2, `1` for projects created after.
     *
     * ---
     * This only affects the default [install linker strategy](https://bun.com/docs/pm/cli/install#isolated-installs):
     * - With `0`, the linker is hoisted.
     * - With `1`, the linker is isolated for workspaces and hoisted for single-package projects.
     */
    configVersion?: 0 | 1;

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
     */
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

  /** @see {@link BunLockFile.packages} */
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
   * A single HTTP cookie: its name, value, and attributes.
   *
   * @example
   * ```js
   * const cookie = new Bun.Cookie("name", "value");
   * console.log(cookie.toString()); // "name=value; Path=/; SameSite=Lax"
   * ```
   */
  class Cookie {
    /**
     * Creates a cookie from a name, value, and optional attributes
     * @param name - The name of the cookie
     * @param value - The value of the cookie
     * @param options - Optional cookie attributes
     */
    constructor(name: string, value: string, options?: CookieInit);

    /**
     * Creates a cookie by parsing a serialized cookie string
     * @param cookieString - A serialized cookie string, like `"name=value; Path=/"`
     */
    constructor(cookieString: string);

    /**
     * Creates a cookie from an attributes object
     * @param cookieObject - The cookie's name, value, and attributes
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
     * The cookie's `Domain` attribute, or `undefined` if not set
     */
    domain?: string;

    /**
     * The cookie's `Path` attribute. Defaults to `/`.
     */
    path: string;

    /**
     * The cookie's expiration date, or `undefined` if not set
     */
    expires?: Date;

    /**
     * Whether the cookie has the `Secure` attribute
     */
    secure: boolean;

    /**
     * The cookie's `SameSite` attribute. Defaults to `lax`.
     */
    sameSite: CookieSameSite;

    /**
     * Whether the cookie has the `Partitioned` attribute
     */
    partitioned: boolean;

    /**
     * The cookie's maximum age in seconds, or `undefined` if not set
     */
    maxAge?: number;

    /**
     * Whether the cookie has the `HttpOnly` attribute
     */
    httpOnly: boolean;

    /**
     * Returns `true` if the cookie has expired
     */
    isExpired(): boolean;

    /**
     * Serializes the cookie to a string
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
     * Serializes the cookie to a string. Alias of {@link Cookie.serialize}.
     */
    toString(): string;

    /**
     * Returns the cookie's name, value, and attributes as a plain object
     */
    toJSON(): CookieInit;

    /**
     * Parses a serialized cookie string into a `Cookie`
     * @param cookieString - A serialized cookie string, like `"name=value; Path=/"`
     */
    static parse(cookieString: string): Cookie;

    /**
     * Creates a cookie from a name, value, and optional attributes
     */
    static from(name: string, value: string, options?: CookieInit): Cookie;
  }

  /**
   * A Map-like collection of cookies.
   *
   * Iterable, so it works with `for...of` loops.
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
     * Returns the `Set-Cookie` header values that apply the changes made to this map.
     *
     * @returns An array of `Set-Cookie` header values
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
     * @returns An object mapping cookie names to values
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
