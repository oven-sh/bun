export {};

type _ReadableStream<T> = typeof globalThis extends {
  onerror: any;
  ReadableStream: infer T;
}
  ? T
  : import("stream/web").ReadableStream<T>;
type _WritableStream<T> = typeof globalThis extends {
  onerror: any;
  WritableStream: infer T;
}
  ? T
  : import("stream/web").WritableStream<T>;

type _TextEncoder = typeof globalThis extends {
  onerror: any;
  TextEncoder: infer T;
}
  ? T
  : Bun.TextEncoder;

type _TextDecoder = typeof globalThis extends {
  onerror: any;
  TextDecoder: infer T;
}
  ? T
  : Bun.TextDecoder;

type _Performance = typeof globalThis extends {
  onerror: any;
}
  ? {}
  : import("perf_hooks").Performance;

type _Worker = typeof globalThis extends { onerror: any; Worker: infer T } ? T : Bun.Worker;

type _Event = typeof globalThis extends { onerror: any; Event: any }
  ? {}
  : {
      /** This is not used in Node.js and is provided purely for completeness. */
      readonly bubbles: boolean;
      /** Alias for event.stopPropagation(). This is not used in Node.js and is provided purely for completeness. */
      cancelBubble: () => void;
      /** True if the event was created with the cancelable option */
      readonly cancelable: boolean;
      /** This is not used in Node.js and is provided purely for completeness. */
      readonly composed: boolean;
      /** Returns an array containing the current EventTarget as the only entry or empty if the event is not being dispatched. This is not used in Node.js and is provided purely for completeness. */
      composedPath(): [EventTarget?];
      /** Alias for event.target. */
      readonly currentTarget: EventTarget | null;
      /** Is true if cancelable is true and event.preventDefault() has been called. */
      readonly defaultPrevented: boolean;
      /** This is not used in Node.js and is provided purely for completeness. */
      readonly eventPhase: 0 | 2;
      /** The `AbortSignal` "abort" event is emitted with `isTrusted` set to `true`. The value is `false` in all other cases. */
      readonly isTrusted: boolean;
      /** Sets the `defaultPrevented` property to `true` if `cancelable` is `true`. */
      preventDefault(): void;
      /** This is not used in Node.js and is provided purely for completeness. */
      returnValue: boolean;
      /** Alias for event.target. */
      readonly srcElement: EventTarget | null;
      /** Stops the invocation of event listeners after the current one completes. */
      stopImmediatePropagation(): void;
      /** This is not used in Node.js and is provided purely for completeness. */
      stopPropagation(): void;
      /** The `EventTarget` dispatching the event */
      readonly target: EventTarget | null;
      /** The millisecond timestamp when the Event object was created. */
      readonly timeStamp: number;
      /** Returns the type of event, e.g. "click", "hashchange", or "submit". */
      readonly type: string;
    };

type _EventTarget = typeof globalThis extends {
  onerror: any;
  EventTarget: any;
}
  ? {}
  : {
      /**
       * Adds a new handler for the `type` event. Any given `listener` is added only once per `type` and per `capture` option value.
       *
       * If the `once` option is true, the `listener` is removed after the next time a `type` event is dispatched.
       *
       * The `capture` option is not used by Node.js in any functional way other than tracking registered event listeners per the `EventTarget` specification.
       * Specifically, the `capture` option is used as part of the key when registering a `listener`.
       * Any individual `listener` may be added once with `capture = false`, and once with `capture = true`.
       */
      addEventListener(
        type: string,
        listener: EventListener | EventListenerObject,
        options?: AddEventListenerOptions | boolean,
      ): void;
      /** Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise. */
      dispatchEvent(event: Event): boolean;
      /** Removes the event listener in target's event listener list with the same type, callback, and options. */
      removeEventListener(
        type: string,
        listener: EventListener | EventListenerObject,
        options?: Bun.EventListenerOptions | boolean,
      ): void;
    };

type _Crypto = typeof globalThis extends {
  onerror: any;
  Crypto: infer T;
}
  ? T
  : import("crypto").webcrypto.Crypto;

type _SubtleCrypto = typeof globalThis extends {
  onerror: any;
  SubtleCrypto: infer T;
}
  ? T
  : import("crypto").webcrypto.SubtleCrypto;

type _CryptoKey = typeof globalThis extends {
  onerror: any;
  CryptoKey: infer T;
}
  ? T
  : import("crypto").webcrypto.CryptoKey;

type _Body = typeof globalThis extends { onerror: any }
  ? {}
  : {
      readonly body: ReadableStream | null;
      readonly bodyUsed: boolean;
      readonly arrayBuffer: () => Promise<ArrayBuffer>;
      readonly blob: () => Promise<Blob>;
      readonly formData: () => Promise<FormData>;
      readonly json: () => Promise<unknown>;
      readonly text: () => Promise<string>;
    };

import type { MessagePort } from "worker_threads";
import type { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from "util";
import type { WebSocket as _WebSocket } from "ws";

declare module "*.txt" {
  var text: string;
  export = text;
}

declare module "*.toml" {
  var contents: any;
  export = contents;
}

declare global {
  var Bun: typeof import("bun");

  namespace NodeJS {
    interface Process {
      readonly version: string;
      browser: boolean;

      /** Whether you are using Bun */
      isBun: 1; // FIXME: this should actually return a boolean
      /** The current git sha of Bun **/
      revision: string;
      reallyExit(code?: number): never;
      dlopen(module: { exports: any }, filename: string, flags?: number): void;
    }
  }

  namespace Bun {
    type ArrayBufferView = NodeJS.TypedArray | DataView;
    type StringOrBuffer = string | NodeJS.TypedArray | ArrayBufferLike;
    type PathLike = string | NodeJS.TypedArray | ArrayBufferLike | URL;
    type BodyInit = ReadableStream | XMLHttpRequestBodyInit | URLSearchParams;
    type XMLHttpRequestBodyInit = Blob | BufferSource | string | FormData;
    type ReadableStreamController<T> = ReadableStreamDefaultController<T>;
    type ReadableStreamDefaultReadResult<T> =
      | ReadableStreamDefaultReadValueResult<T>
      | ReadableStreamDefaultReadDoneResult;
    type ReadableStreamReader<T> = ReadableStreamDefaultReader<T>;
    type Transferable = ArrayBuffer | MessagePort;
    type MessageEventSource = undefined;
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
    type BufferSource = NodeJS.TypedArray | DataView | ArrayBufferLike;
    type DOMHighResTimeStamp = number;
    type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

    type BlobOrStringOrBuffer = string | NodeJS.TypedArray | ArrayBufferLike | Blob;

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
    type Architecture = "arm" | "arm64" | "ia32" | "mips" | "mipsel" | "ppc" | "ppc64" | "s390" | "s390x" | "x64";

    type UncaughtExceptionListener = (error: Error, origin: UncaughtExceptionOrigin) => void;
    /**
     * Most of the time the unhandledRejection will be an Error, but this should not be relied upon
     * as *anything* can be thrown/rejected, it is therefore unsafe to assume that the value is an Error.
     */
    type UnhandledRejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

    type MultipleResolveListener = (type: MultipleResolveType, promise: Promise<unknown>, value: unknown) => void;

    type HeadersInit = Headers | Record<string, string> | Array<[string, string]> | IterableIterator<[string, string]>;

    type ResponseType = "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";

    interface TextEncoder extends NodeTextEncoder {
      new (encoding?: Bun.Encoding, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextEncoder;
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
      encodeInto(src?: string, dest?: Bun.BufferSource): import("util").EncodeIntoResult;
    }

    interface TextDecoder extends NodeTextDecoder {
      new (encoding?: Bun.Encoding, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoder;
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
    interface MessageEvent<T = any> extends Event {
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

    interface ReadableStreamDefaultReadManyResult<T> {
      done: boolean;
      /** Number of bytes */
      size: number;
      value: T[];
    }

    interface ResponseInit {
      headers?: HeadersInit;
      /** @default 200 */
      status?: number;

      /** @default "OK" */
      statusText?: string;
    }

    interface EventSourceEventMap {
      error: Event;
      message: MessageEvent;
      open: Event;
    }

    interface EventInit {
      bubbles?: boolean;
      cancelable?: boolean;
      composed?: boolean;
    }

    interface EventListenerOptions {
      /** Not directly used by Node.js. Added for API completeness. Default: `false`. */
      capture?: boolean;
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  }

  interface ReadableStream<R = any> extends _ReadableStream<R> {}
  var ReadableStream: typeof globalThis extends {
    onerror: any;
    ReadableStream: infer T;
  }
    ? T
    : {
        prototype: ReadableStream;
        new <R = any>(underlyingSource?: Bun.UnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
        new <R = any>(
          underlyingSource?: Bun.DirectUnderlyingSource<R>,
          strategy?: QueuingStrategy<R>,
        ): ReadableStream<R>;
      };

  interface WritableStream<W = any> extends _WritableStream<W> {}
  var WritableStream: typeof globalThis extends {
    onerror: any;
    WritableStream: infer T;
  }
    ? T
    : {
        prototype: WritableStream;
        new <W = any>(underlyingSink?: Bun.UnderlyingSink<W>, strategy?: QueuingStrategy<W>): WritableStream<W>;
      };

  interface Worker extends _Worker {}
  var Worker: typeof globalThis extends {
    onerror: any;
    Worker: infer T;
  }
    ? T
    : {
        prototype: Worker;
        new (scriptURL: string | URL, options?: Bun.WorkerOptions | undefined): Worker;
        /**
         * This is the cloned value of the `data` property passed to `new Worker()`
         *
         * This is Bun's equivalent of `workerData` in Node.js.
         */
        data: any;
      };

  interface WebSocket extends _WebSocket {}
  var WebSocket: typeof globalThis extends {
    onerror: any;
    WebSocket: infer T;
  }
    ? T
    : typeof _WebSocket;

  interface Crypto extends _Crypto {}
  var Crypto: typeof globalThis extends {
    onerror: any;
    Crypto: infer T;
  }
    ? T
    : {
        prototype: Crypto;
        new (): Crypto;
      };

  var crypto: typeof globalThis extends {
    onerror: any;
    crypto: infer T;
  }
    ? T
    : Crypto;

  /**
   * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextEncoder` API. All
   * instances of `TextEncoder` only support UTF-8 encoding.
   *
   * ```js
   * const encoder = new TextEncoder();
   * const uint8array = encoder.encode('this is some data');
   * ```
   */
  interface TextEncoder extends _TextEncoder {}
  var TextEncoder: typeof globalThis extends {
    onerror: any;
    TextEncoder: infer T;
  }
    ? T
    : typeof TextEncoder;

  interface TextDecoder extends _TextDecoder {}
  var TextDecoder: typeof globalThis extends {
    onerror: any;
    TextDecoder: infer T;
  }
    ? T
    : typeof TextDecoder;

  interface Performance extends _Performance {}
  var performance: typeof globalThis extends {
    onerror: any;
    performance: infer T;
  }
    ? T
    : Performance;

  interface Event extends _Event {}
  var Event: typeof globalThis extends { onerror: any; Event: infer T }
    ? T
    : {
        prototype: Event;
        new (type: string, eventInitDict?: Bun.EventInit): Event;
      };
  interface EventTarget extends _EventTarget {}
  var EventTarget: typeof globalThis extends {
    onerror: any;
    EventTarget: infer T;
  }
    ? T
    : {
        prototype: EventTarget;
        new (): EventTarget;
      };

  interface Body extends _Body {}

  interface File extends Blob {
    /**
     * Create a new [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
     *
     * @param `parts` - An array of strings, numbers, BufferSource, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
     * @param `name` - The name of the file
     * @param `options` - An object containing properties to be added to the [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
     */
    new (parts: Bun.BlobPart[], name: string, options?: BlobPropertyBag & { lastModified?: Date | number }): File;
    readonly lastModified: number;
    readonly name: string;
  }
  var File: typeof globalThis extends { onerror: any; File: infer T } ? T : typeof File;

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

    /**
     * Override the default TLS options
     */
    tls?: {
      rejectUnauthorized?: boolean | undefined; // Defaults to true
      checkServerIdentity?: any; // TODO: change `any` to `checkServerIdentity`
    };
  }

  /**
   * ShadowRealms are a distinct global environment, with its own global object
   * containing its own intrinsics and built-ins (standard objects that are not
   * bound to global variables, like the initial value of Object.prototype).
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
  interface ShadowRealm {
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
    importValue(specifier: string, bindingName: string): Promise<any>;
    evaluate(sourceText: string): any;
  }

  var ShadowRealm: {
    prototype: ShadowRealm;
    new (): ShadowRealm;
  };

  /**
   * Send a HTTP(s) request
   *
   * @param request Request object
   * @param init A structured value that contains settings for the fetch() request.
   *
   * @returns A promise that resolves to {@link Response} object.
   */

  // tslint:disable-next-line:unified-signatures
  function fetch(request: Request, init?: RequestInit): Promise<Response>;
  /**
   * Send a HTTP(s) request
   *
   * @param url URL string
   * @param init A structured value that contains settings for the fetch() request.
   *
   * @returns A promise that resolves to {@link Response} object.
   */
  function fetch(url: string | URL | Request, init?: FetchRequestInit): Promise<Response>;

  function queueMicrotask(callback: (...args: any[]) => void): void;
  /**
   * Log an error using the default exception handler
   * @param error Error or string
   */
  function reportError(error: any): void;

  interface Timer {
    ref(): Timer;
    unref(): Timer;
    hasRef(): boolean;

    [Symbol.toPrimitive](): number;
  }

  /**
   * Cancel a repeating timer by its timer ID.
   * @param id timer id
   */
  function clearInterval(id?: number | Timer): void;
  /**
   * Cancel a delayed function call by its timer ID.
   * @param id timer id
   */
  function clearTimeout(id?: number | Timer): void;
  /**
   * Cancel an immediate function call by its immediate ID.
   * @param id immediate id
   */
  function clearImmediate(id?: number | Timer): void;
  /**
   * Run a function immediately after main event loop is vacant
   * @param handler function to call
   */
  function setImmediate(handler: Bun.TimerHandler, ...arguments: any[]): Timer;
  /**
   * Run a function every `interval` milliseconds
   * @param handler function to call
   * @param interval milliseconds to wait between calls
   */
  function setInterval(handler: Bun.TimerHandler, interval?: number, ...arguments: any[]): Timer;
  /**
   * Run a function after `timeout` (milliseconds)
   * @param handler function to call
   * @param timeout milliseconds to wait between calls
   */
  function setTimeout(handler: Bun.TimerHandler, timeout?: number, ...arguments: any[]): Timer;

  function addEventListener<K extends keyof EventMap>(
    type: K,
    listener: (this: object, ev: EventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  function addEventListener(
    type: string,
    listener: Bun.EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  function removeEventListener<K extends keyof EventMap>(
    type: K,
    listener: (this: object, ev: EventMap[K]) => any,
    options?: boolean | Bun.EventListenerOptions,
  ): void;
  function removeEventListener(
    type: string,
    listener: Bun.EventListenerOrEventListenerObject,
    options?: boolean | Bun.EventListenerOptions,
  ): void;

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

  var ErrorEvent: {
    prototype: ErrorEvent;
    new (type: string, eventInitDict?: Bun.ErrorEventInit): ErrorEvent;
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

  var CloseEvent: {
    prototype: CloseEvent;
    new (type: string, eventInitDict?: Bun.CloseEventInit): CloseEvent;
  };

  interface MessageEvent<T = any> extends Bun.MessageEvent<T> {}
  var MessageEvent: typeof globalThis extends {
    onerror: any;
    MessageEvent: infer T;
  }
    ? T
    : {
        prototype: MessageEvent;
        new <T>(type: string, eventInitDict?: Bun.MessageEventInit<T>): MessageEvent<T>;
      };

  interface CustomEvent<T = any> extends Event {
    /** Returns any custom data event was created with. Typically used for synthetic events. */
    readonly detail: T;
  }

  var CustomEvent: {
    prototype: CustomEvent;
    new <T>(type: string, eventInitDict?: Bun.CustomEventInit<T>): CustomEvent<T>;
  };

  /**
   * The URL interface represents an object providing static methods used for
   * creating object URLs.
   */
  interface URL {
    new (url: string | URL, base?: string | URL): URL;
    /** Not implemented yet */
    createObjectURL(obj: Blob): string;
    /** Not implemented yet */
    revokeObjectURL(url: string): void;

    /**
     * Check if `url` is a valid URL string
     *
     * @param url URL string to parse
     * @param base URL to resolve against
     */
    canParse(url: string, base?: string): boolean;
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

  interface AddEventListenerOptions extends Bun.EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }

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
  var Loader: {
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
        dependencies: Array<(typeof Loader)["registry"] extends Map<any, infer V> ? V : any>;
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
  interface ByteLengthQueuingStrategy extends QueuingStrategy<ArrayBufferView> {
    readonly highWaterMark: number;
    // changed from QueuingStrategySize<BufferSource>
    // to avoid conflict with lib.dom.d.ts
    readonly size: QueuingStrategySize<ArrayBufferView>;
  }

  var ByteLengthQueuingStrategy: {
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
    write(data: Bun.BufferSource | ArrayBuffer | string): number | Promise<number>;
    end(): number | Promise<number>;
    flush(): number | Promise<number>;
    start(): void;
  }

  var ReadableStreamDefaultController: {
    prototype: ReadableStreamDefaultController;
    new (): ReadableStreamDefaultController;
  };

  interface ReadableStreamDefaultReader<R = any> extends ReadableStreamGenericReader {
    read(): Promise<Bun.ReadableStreamDefaultReadResult<R>>;
    /**
     * Only available in Bun. If there are multiple chunks in the queue, this will return all of them at the same time.
     * Will only return a promise if the data is not immediately available.
     */
    readMany(): Promise<Bun.ReadableStreamDefaultReadManyResult<R>> | Bun.ReadableStreamDefaultReadManyResult<R>;
    releaseLock(): void;
  }

  var ReadableStreamDefaultReader: {
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

  interface WritableStreamDefaultController {
    error(e?: any): void;
  }

  var WritableStreamDefaultController: {
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

  var WritableStreamDefaultWriter: {
    prototype: WritableStreamDefaultWriter;
    new <W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
  };

  interface TransformStream<I = any, O = any> {
    readonly readable: ReadableStream<O>;
    readonly writable: WritableStream<I>;
  }

  var TransformStream: {
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

  var TransformStreamDefaultController: {
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

  var CountQueuingStrategy: {
    prototype: CountQueuingStrategy;
    new (init: QueuingStrategyInit): CountQueuingStrategy;
  };

  interface QueuingStrategySize<T = any> {
    (chunk?: T): number;
  }

  interface Transformer<I = any, O = any> {
    flush?: Bun.TransformerFlushCallback<O>;
    readableType?: undefined;
    start?: Bun.TransformerStartCallback<O>;
    transform?: Bun.TransformerTransformCallback<I, O>;
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
    readonly message: string;
    readonly name: string;
    readonly INDEX_SIZE_ERR: 1;
    readonly DOMSTRING_SIZE_ERR: 2;
    readonly HIERARCHY_REQUEST_ERR: 3;
    readonly WRONG_DOCUMENT_ERR: 4;
    readonly INVALID_CHARACTER_ERR: 5;
    readonly NO_DATA_ALLOWED_ERR: 6;
    readonly NO_MODIFICATION_ALLOWED_ERR: 7;
    readonly NOT_FOUND_ERR: 8;
    readonly NOT_SUPPORTED_ERR: 9;
    readonly INUSE_ATTRIBUTE_ERR: 10;
    readonly INVALID_STATE_ERR: 11;
    readonly SYNTAX_ERR: 12;
    readonly INVALID_MODIFICATION_ERR: 13;
    readonly NAMESPACE_ERR: 14;
    readonly INVALID_ACCESS_ERR: 15;
    readonly VALIDATION_ERR: 16;
    readonly TYPE_MISMATCH_ERR: 17;
    readonly SECURITY_ERR: 18;
    readonly NETWORK_ERR: 19;
    readonly ABORT_ERR: 20;
    readonly URL_MISMATCH_ERR: 21;
    readonly QUOTA_EXCEEDED_ERR: 22;
    readonly TIMEOUT_ERR: 23;
    readonly INVALID_NODE_TYPE_ERR: 24;
    readonly DATA_CLONE_ERR: 25;
  }

  var DOMException: typeof globalThis extends {
    onerror: any;
    DOMException: infer T;
  }
    ? T
    : {
        prototype: DOMException;
        new (message?: string, name?: string): DOMException;
      };

  function alert(message?: string): void;
  function confirm(message?: string): boolean;
  function prompt(message?: string, _default?: string): string | null;

  var SubtleCrypto: typeof globalThis extends {
    onerror: any;
    SubtleCrypto: infer T;
  }
    ? T
    : {
        prototype: _SubtleCrypto;
        new (): _SubtleCrypto;
      };

  interface CryptoKey extends _CryptoKey {}
  var CryptoKey: {
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

  class ResolveMessage {
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

  class BuildMessage {
    readonly name: "BuildMessage";
    readonly position: Position | null;
    readonly message: string;
    readonly level: "error" | "warning" | "info" | "debug" | "verbose";
  }

  // Declare "static" methods in Error
  interface ErrorConstructor {
    /** Create .stack property on a target object */
    // eslint-disable-next-line @typescript-eslint/ban-types
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;

    /**
     * Optional override for formatting stack traces
     *
     * @see https://v8.dev/docs/stack-trace-api#customizing-stack-traces
     */
    prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;

    stackTraceLimit: number;
  }

  interface ArrayBufferConstructor {
    new (byteLength: number, options: { maxByteLength?: number }): ArrayBuffer;
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

  interface ArrayConstructor {
    /**
     * Create an array from an iterable or async iterable object.
     * Values from the iterable are awaited.
     *
     * ```ts
     * await Array.fromAsync([1]); // [1]
     * await Array.fromAsync([Promise.resolve(1)]); // [1]
     * await Array.fromAsync((async function*() { yield 1 })()); // [1]
     * ```
     *
     * @param arrayLike - The iterable or async iterable to convert to an array.
     * @returns A {@link Promise} whose fulfillment is a new {@link Array} instance containing the values from the iterator.
     */
    fromAsync<T>(arrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>): Promise<Awaited<T>[]>;

    /**
     * Create an array from an iterable or async iterable object.
     * Values from the iterable are awaited. Results of the map function are also awaited.
     *
     * ```ts
     * await Array.fromAsync([1]); // [1]
     * await Array.fromAsync([Promise.resolve(1)]); // [1]
     * await Array.fromAsync((async function*() { yield 1 })()); // [1]
     * await Array.fromAsync([1], (n) => n + 1); // [2]
     * await Array.fromAsync([1], (n) => Promise.resolve(n + 1)); // [2]
     * ```
     *
     * @param arrayLike - The iterable or async iterable to convert to an array.
     * @param mapFn - A mapper function that transforms each element of `arrayLike` after awaiting them.
     * @param thisArg - The `this` to which `mapFn` is bound.
     * @returns A {@link Promise} whose fulfillment is a new {@link Array} instance containing the values from the iterator.
     */
    fromAsync<T, U>(
      arrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>,
      mapFn?: (value: T, index: number) => U,
      thisArg?: any,
    ): Promise<Awaited<U>[]>;
  }

  interface ConsoleOptions {
    stdout: import("stream").Writable;
    stderr?: import("stream").Writable;
    ignoreErrors?: boolean;
    colorMode?: boolean | "auto";
    inspectOptions?: import("util").InspectOptions;
    groupIndentation?: number;
  }

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

    /**
     * Creates a new Console with one or two writable stream instances. stdout is a writable stream to print log or info output. stderr is used for warning or error output. If stderr is not provided, stdout is used for stderr.
     */
    // Console: {
    //   new (options: ConsoleOptions): Console;
    //   new (
    //     stdout: import("stream").Writable,
    //     stderr?: import("stream").Writable,
    //     ignoreErrors?: boolean,
    //   ): Console;
    // };
  }

  var console: Console;

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
    url: string;
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
     * The environment variables of the process
     *
     * ```ts
     * import.meta.env === process.env
     * ```
     */
    readonly env: NodeJS.ProcessEnv;

    /**
     * @deprecated Use `require.resolve` or `Bun.resolveSync(moduleId, path.dirname(parent))` instead
     *
     * Resolve a module ID the same as if you imported it
     *
     * The `parent` argument is optional, and defaults to the current module's path.
     */
    resolveSync(moduleId: string, parent?: string): string;

    /**
     * Load a CommonJS module within an ES Module. Bun's transpiler rewrites all
     * calls to `require` with `import.meta.require` when transpiling ES Modules
     * for the runtime.
     *
     * Warning: **This API is not stable** and may change or be removed in the
     * future. Use at your own risk.
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

    /** Alias of `import.meta.dir`. Exists for Node.js compatibility */
    readonly dirname: string;

    /** Alias of `import.meta.path`. Exists for Node.js compatibility */
    readonly filename: string;
  }

  /**
   * NodeJS-style `require` function
   *
   * @param moduleId - The module ID to resolve
   */
  var require: NodeJS.Require;

  /** Same as module.exports */
  var exports: any;

  interface NodeModule {
    exports: any;
  }

  var module: NodeModule;

  /**
   * Creates a deep clone of an object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/structuredClone)
   */
  function structuredClone<T>(value: T, options?: Bun.StructuredSerializeOptions): T;

  /**
   * Post a message to the parent thread.
   *
   * Only useful in a worker thread; calling this from the main thread does nothing.
   */
  function postMessage(message: any, transfer?: Bun.Transferable[]): void;

  interface EventSourceInit {
    withCredentials?: boolean;
  }

  interface EventSource extends Bun.EventSource {}
  var EventSource: typeof globalThis extends {
    onerror: any;
    EventSource: infer T;
  }
    ? T
    : EventSource;

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

  interface Navigator {
    readonly userAgent: string;
    readonly platform: "MacIntel" | "Win32" | "Linux x86_64";
    readonly hardwareConcurrency: number;
  }

  var navigator: Navigator;

  interface BlobPropertyBag {
    /** Set a default "type". Not yet implemented. */
    type?: string;
    /** Not implemented in Bun yet. */
    // endings?: "transparent" | "native";
  }

  interface Blob {
    /**
     * Create a new [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
     *
     * @param `parts` - An array of strings, numbers, BufferSource, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
     * @param `options` - An object containing properties to be added to the [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
     */
    new (parts?: Bun.BlobPart[], options?: BlobPropertyBag): Blob;
    /**
     * Read the data from the blob as a JSON object.
     *
     * This first decodes the data from UTF-8, then parses it as JSON.
     */
    // eslint-disable-next-line @definitelytyped/no-unnecessary-generics
    json(): Promise<any>;

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
  }
  var Blob: typeof globalThis extends {
    onerror: any;
    Blob: infer T;
  }
    ? T
    : typeof Blob;

  var Response: typeof globalThis extends {
    onerror: any;
    Response: infer T;
  }
    ? T
    : typeof import("./fetch").Response;

  var Request: typeof globalThis extends {
    onerror: any;
    Request: infer T;
  }
    ? T
    : {
        prototype: Request;
        new (requestInfo: string, requestInit?: RequestInit): Request;
        new (requestInfo: RequestInit & { url: string }): Request;
        new (requestInfo: Request, requestInit?: RequestInit): Request;
      };

  interface Headers {
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
}
