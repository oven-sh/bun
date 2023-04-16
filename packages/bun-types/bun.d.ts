interface VoidFunction {
  (): void;
}

declare namespace Bun {
  interface Env extends Dict<string> {
    NODE_ENV: string;
  }
}

/**
 *
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
 *
 */
declare module "bun" {
  type ArrayBufferView = TypedArray | DataView;
  import { Encoding as CryptoEncoding } from "crypto";
  /**
   * The environment variables of the process
   *
   * Defaults to `process.env` as it was when the current Bun process launched.
   *
   * Changes to `process.env` at runtime won't automatically be reflected in the default value. For that, you can pass `process.env` explicitly.
   *
   */
  export const env: Bun.Env;
  export const origin: string;

  /**
   * Find the path to an executable, similar to typing which in your terminal. Reads the `PATH` environment variable unless overridden with `options.PATH`.
   *
   * @param {string} command The name of the executable or script
   * @param {string} options.PATH Overrides the PATH environment variable
   * @param {string} options.cwd Limits the search to a particular directory in which to searc
   *
   */
  export function which(
    command: string,
    options?: { PATH?: string; cwd?: string },
  ): string;

  export type Serve<WebSocketDataType = undefined> =
    | ServeOptions
    | TLSServeOptions
    | WebSocketServeOptions<WebSocketDataType>
    | TLSWebSocketServeOptions<WebSocketDataType>;

  /**
   * Start a fast HTTP server.
   *
   * @param options Server options (port defaults to $PORT || 3000)
   *
   * -----
   *
   * @example
   *
   * ```ts
   * Bun.serve({
   *   fetch(req: Request): Response | Promise<Response> {
   *     return new Response("Hello World!");
   *   },
   *
   *   // Optional port number - the default value is 3000
   *   port: process.env.PORT || 3000,
   * });
   * ```
   * -----
   *
   * @example
   *
   * Send a file
   *
   * ```ts
   * Bun.serve({
   *   fetch(req: Request): Response | Promise<Response> {
   *     return new Response(Bun.file("./package.json"));
   *   },
   *
   *   // Optional port number - the default value is 3000
   *   port: process.env.PORT || 3000,
   * });
   * ```
   */
  export function serve<T>(
    options:
      | ServeOptions
      | TLSServeOptions
      | WebSocketServeOptions<T>
      | TLSWebSocketServeOptions<T>,
  ): Server;

  /**
   * Synchronously resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveError`
   */
  // tslint:disable-next-line:unified-signatures
  export function resolveSync(moduleId: string, parent: string): string;

  /**
   * Resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveError`
   *
   * For now, use the sync version. There is zero performance benefit to using this async version. It exists for future-proofing.
   */
  // tslint:disable-next-line:unified-signatures
  export function resolve(moduleId: string, parent: string): Promise<string>;

  /**
   *
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file.
   *
   * @param destination The file or file path to write to
   * @param input The data to copy into `destination`.
   * @returns A promise that resolves with the number of bytes written.
   */
  // tslint:disable-next-line:unified-signatures
  export function write(
    destination: BunFile | PathLike,
    input: Blob | TypedArray | ArrayBufferLike | string | BlobPart[],
  ): Promise<number>;

  /**
   *
   * Persist a {@link Response} body to disk.
   *
   * @param destination The file to write to. If the file doesn't exist,
   * it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input - `Response` object
   * @returns A promise that resolves with the number of bytes written.
   */
  export function write(destination: BunFile, input: Response): Promise<number>;

  /**
   *
   * Persist a {@link Response} body to disk.
   *
   * @param destinationPath The file path to write to. If the file doesn't
   * exist, it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input - `Response` object
   * @returns A promise that resolves with the number of bytes written.
   */
  // tslint:disable-next-line:unified-signatures
  export function write(
    destinationPath: PathLike,
    input: Response,
  ): Promise<number>;

  /**
   *
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
  // tslint:disable-next-line:unified-signatures
  export function write(destination: BunFile, input: BunFile): Promise<number>;

  /**
   *
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
  // tslint:disable-next-line:unified-signatures
  export function write(
    destinationPath: PathLike,
    input: BunFile,
  ): Promise<number>;

  export interface SystemError extends Error {
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
  export function concatArrayBuffers(
    buffers: Array<ArrayBufferView | ArrayBufferLike>,
  ): ArrayBuffer;

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
  export function readableStreamToArrayBuffer(
    stream: ReadableStream,
  ): Promise<ArrayBuffer> | ArrayBuffer;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single {@link Blob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link Blob}.
   */
  export function readableStreamToBlob(stream: ReadableStream): Promise<Blob>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   */
  export function readableStreamToText(stream: ReadableStream): Promise<string>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string and parse as JSON. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   */
  export function readableStreamToJSON(stream: ReadableStream): Promise<any>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * @param stream The stream to consume
   * @returns A promise that resolves with the chunks as an array
   *
   */
  export function readableStreamToArray<T>(
    stream: ReadableStream,
  ): Promise<T[]> | T[];

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
   * 20 GB/s, depending on how much data is being escaped and whether there is non-ascii
   * text.
   *
   * Non-string types will be converted to a string before escaping.
   */
  export function escapeHTML(input: string | object | number | boolean): string;

  /**
   * Convert a filesystem path to a file:// URL.
   *
   * @param path The path to convert.
   * @returns A {@link URL} with the file:// scheme.
   *
   * @example
   * ```js
   * const url = Bun.pathToFileURL("/foo/bar.txt");
   * console.log(url.href); // "file:///foo/bar.txt"
   *```
   *
   * Internally, this function uses WebKit's URL API to
   * convert the path to a file:// URL.
   */
  export function pathToFileURL(path: string): URL;

  export interface Peek {
    <T = undefined>(promise: T | Promise<T>): Promise<T> | T;
    status<T = undefined>(
      promise: T | Promise<T>,
    ): "pending" | "fulfilled" | "rejected";
  }
  /**
   * Extract the value from the Promise in the same tick of the event loop
   */
  export const peek: Peek;

  /**
   * Convert a {@link URL} to a filesystem path.
   * @param url The URL to convert.
   * @returns A filesystem path.
   * @throws If the URL is not a URL.
   * @example
   * ```js
   * const path = Bun.fileURLToPath(new URL("file:///foo/bar.txt"));
   * console.log(path); // "/foo/bar.txt"
   * ```
   */
  export function fileURLToPath(url: URL): string;

  /**
   * Fast incremental writer that becomes an `ArrayBuffer` on end().
   */
  export class ArrayBufferSink {
    constructor();

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

    write(
      chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    ): number;
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

  export const dns: {
    /**
     * Lookup the IP address for a hostname
     *
     * Uses non-blocking APIs by default
     *
     * @param hostname The hostname to lookup
     * @param options Options for the lookup
     *
     * ## Example
     *
     * ```js
     * const [{ address }] = await Bun.dns.lookup('example.com');
     * ```
     *
     * ### Filter results to IPv4:
     *
     * ```js
     * import { dns } from 'bun';
     * const [{ address }] = await dns.lookup('example.com', {family: 4});
     * console.log(address); // "123.122.22.126"
     * ```
     *
     * ### Filter results to IPv6:
     *
     * ```js
     * import { dns } from 'bun';
     * const [{ address }] = await dns.lookup('example.com', {family: 6});
     * console.log(address); // "2001:db8::1"
     * ```
     *
     * #### DNS resolver client
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
    lookup(
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
         */
        backend?: "libc" | "c-ares" | "system" | "getaddrinfo";
      },
    ): Promise<DNSLookup[]>;
  };

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

  /**
   * Fast incremental writer for files and pipes.
   *
   * This uses the same interface as {@link ArrayBufferSink}, but writes to a file or pipe.
   */
  export interface FileSink {
    /**
     * Write a chunk of data to the file.
     *
     * If the file descriptor is not writable yet, the data is buffered.
     */
    write(
      chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    ): number;
    /**
     * Flush the internal buffer, committing the data to disk or the pipe.
     */
    flush(): number | Promise<number>;
    /**
     * Close the file descriptor. This also flushes the internal buffer.
     */
    end(error?: Error): number | Promise<number>;

    start(options?: {
      /**
       * Preallocate an internal buffer of this size
       * This can significantly improve performance when the chunk size is small
       */
      highWaterMark?: number;
    }): void;

    /**
     * For FIFOs & pipes, this lets you decide whether Bun's process should
     * remain alive until the pipe is closed.
     *
     * By default, it is automatically managed. While the stream is open, the
     * process remains alive and once the other end hangs up or the stream
     * closes, the process exits.
     *
     * If you previously called {@link unref}, you can call this again to re-enable automatic management.
     *
     * Internally, it will reference count the number of times this is called. By default, that number is 1
     *
     * If the file is not a FIFO or pipe, {@link ref} and {@link unref} do
     * nothing. If the pipe is already closed, this does nothing.
     */
    ref(): void;

    /**
     * For FIFOs & pipes, this lets you decide whether Bun's process should
     * remain alive until the pipe is closed.
     *
     * If you want to allow Bun's process to terminate while the stream is open,
     * call this.
     *
     * If the file is not a FIFO or pipe, {@link ref} and {@link unref} do
     * nothing. If the pipe is already closed, this does nothing.
     */
    unref(): void;
  }

  export interface FileBlob extends BunFile {}
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
   *
   */
  export interface BunFile extends Blob {
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
     *
     */
    /**
     * Offset any operation on the file starting at `begin`
     *
     * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray). Does not copy the file, open the file, or modify the file.
     *
     * If `begin` > 0, {@link Bun.write()} will be slower on macOS
     *
     * @param begin - start offset in bytes
     * @param contentType - MIME type for the new BunFile
     */
    slice(begin?: number, contentType?: string): BunFile;

    /**
     * @param contentType - MIME type for the new BunFile
     */
    slice(contentType?: string): BunFile;

    /**
     * Incremental writer for files and pipes.
     */
    writer(options?: { highWaterMark?: number }): FileSink;

    readonly readable: ReadableStream;

    // TODO: writable: WritableStream;

    /**
     * A UNIX timestamp indicating when the file was last modified.
     */
    lastModified: number;
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
  export type MacroMap = Record<string, Record<string, string>>;

  /**
   * Hash a string or array buffer using Wyhash
   *
   * This is not a cryptographic hash function.
   * @param data The data to hash.
   * @param seed The seed to use.
   */
  export const hash: ((
    data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    seed?: number,
  ) => number | bigint) &
    Hash;

  interface Hash {
    wyhash: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
    crc32: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
    adler32: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
    cityHash32: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
    cityHash64: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
    murmur32v3: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
    murmur64v2: (
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      seed?: number,
    ) => number | bigint;
  }

  export type Platform =
    /**
     * When building for bun.js
     */
    | "bun"
    /**
     * When building for the web
     */
    | "browser"
    /**
     * When building for node.js
     */
    | "node"
    | "neutral";

  export type JavaScriptLoader = "jsx" | "js" | "ts" | "tsx";

  /**
   * Fast deep-equality check two objects.
   *
   * This also powers expect().toEqual in `bun:test`
   *
   */
  export function deepEquals(
    a: any,
    b: any,
    /** @default false */
    strict?: boolean,
  ): boolean;

  /**
   * tsconfig.json options supported by Bun
   */
  interface TSConfig {
    extends?: string;
    compilerOptions?: {
      paths?: Record<string, string[]>;
      baseUrl?: string;
      /** "preserve" is not supported yet */
      jsx?: "preserve" | "react" | "react-jsx" | "react-jsxdev" | "react-native";
      jsxFactory?: string;
      jsxFragmentFactory?: string;
      jsxImportSource?: string;
      useDefineForClassFields?: boolean;
      importsNotUsedAsValues?: "remove" | "preserve" | "error";
      /** moduleSuffixes is not supported yet */
      moduleSuffixes?: any;
    };
  }

  export interface TranspilerOptions {
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
    platform?: Platform;

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
  }

  /**
   * Quickly transpile TypeScript, JSX, or JS to modern JavaScript.
   *
   * @example
   * ```js
   * const transpiler = new Bun.Transpiler();
   * transpiler.transformSync(`
   *   const App = () => <div>Hello World</div>;
   *export default App;
   * `);
   * // This outputs:
   * const output = `
   * const App = () => jsx("div", {
   *   children: "Hello World"
   * }, undefined, false, undefined, this);
   *export default App;
   * `
   * ```
   *
   */

  export class Transpiler {
    constructor(options?: TranspilerOptions);

    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     */
    transform(code: StringOrBuffer, loader?: JavaScriptLoader): Promise<string>;
    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     *
     */
    transformSync(
      code: StringOrBuffer,
      loader: JavaScriptLoader,
      ctx: object,
    ): string;
    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     * @param ctx An object to pass to macros
     *
     */
    transformSync(code: StringOrBuffer, ctx: object): string;

    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     *
     */
    transformSync(code: StringOrBuffer, loader?: JavaScriptLoader): string;

    /**
     * Get a list of import paths and paths from a TypeScript, JSX, TSX, or JavaScript file.
     * @param code The code to scan
     * @example
     * ```js
     * const {imports, exports} = transpiler.scan(`
     * import {foo} from "baz";
     * const hello = "hi!";
     * `);
     *
     * console.log(imports); // ["baz"]
     * console.log(exports); // ["hello"]
     * ```
     */
    scan(code: StringOrBuffer): { exports: string[]; imports: Import[] };

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
    scanImports(code: StringOrBuffer): Import[];
  }

  export interface Import {
    path: string;

    kind:
      | "import-statement"
      | "require-call"
      | "require-resolve"
      | "dynamic-import"
      | "import-rule"
      | "url-token"
      | "internal"
      | "entry-point";
  }

  /**
   * **0** means the message was **dropped**
   *
   * **-1** means **backpressure**
   *
   * **> 0** is the **number of bytes sent**
   *
   */
  type ServerWebSocketSendStatus = 0 | -1 | number;

  /**
   * Fast WebSocket API designed for server environments.
   *
   * Features:
   * - **Message compression** - Messages can be compressed
   * - **Backpressure** - If the client is not ready to receive data, the server will tell you.
   * - **Dropped messages** - If the client cannot receive data, the server will tell you.
   * - **Topics** - Messages can be {@link ServerWebSocket.publish}ed to a specific topic and the client can {@link ServerWebSocket.subscribe} to topics
   *
   * This is slightly different than the browser {@link WebSocket} which Bun supports for clients.
   *
   * Powered by [uWebSockets](https://github.com/uNetworking/uWebSockets)
   */
  export interface ServerWebSocket<T = undefined> {
    /**
     *
     * Send a message to the client.
     *
     * @param data The message to send
     * @param compress Should the data be compressed? Ignored if the client does not support compression.
     *
     * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
     *
     * @example
     *
     * ```js
     * const status = ws.send("Hello World");
     * if (status === 0) {
     *   console.log("Message was dropped");
     * } else if (status === -1) {
     *   console.log("Backpressure was applied");
     * } else {
     *   console.log(`Message sent! ${status} bytes sent`);
     * }
     * ```
     *
     * @example
     *
     * ```js
     * ws.send("Feeling very compressed", true);
     * ```
     *
     * @example
     *
     * ```js
     * ws.send(new Uint8Array([1, 2, 3, 4]));
     * ```
     *
     * @example
     *
     * ```js
     * ws.send(new ArrayBuffer(4));
     * ```
     *
     * @example
     *
     * ```js
     * ws.send(new DataView(new ArrayBuffer(4)));
     * ```
     *
     */
    send(
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      compress?: boolean,
    ): ServerWebSocketSendStatus;

    /**
     *
     * Send a message to the client.
     *
     * This function is the same as {@link ServerWebSocket.send} but it only accepts a string. This function includes a fast path.
     *
     * @param data The message to send
     * @param compress Should the data be compressed? Ignored if the client does not support compression.
     *
     * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
     *
     * @example
     *
     * ```js
     * const status = ws.send("Hello World");
     * if (status === 0) {
     *   console.log("Message was dropped");
     * } else if (status === -1) {
     *   console.log("Backpressure was applied");
     * } else {
     *   console.log(`Message sent! ${status} bytes sent`);
     * }
     * ```
     *
     * @example
     *
     * ```js
     * ws.send("Feeling very compressed", true);
     * ```
     *
     *
     */
    sendText(data: string, compress?: boolean): ServerWebSocketSendStatus;

    /**
     *
     * Send a message to the client.
     *
     * This function is the same as {@link ServerWebSocket.send} but it only accepts Uint8Array.
     *
     * @param data The message to send
     * @param compress Should the data be compressed? Ignored if the client does not support compression.
     *
     * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
     *
     *
     * ```js
     * ws.sendBinary(new Uint8Array([1, 2, 3, 4]));
     * ```
     *
     * @example
     *
     * ```js
     * ws.sendBinary(new ArrayBuffer(4));
     * ```
     *
     * @example
     *
     * ```js
     * ws.sendBinary(new DataView(new ArrayBuffer(4)));
     * ```
     *
     */
    sendBinary(data: Uint8Array, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Gently close the connection.
     *
     * @param code The close code
     *
     * @param reason The close reason
     *
     * To close the connection abruptly, use `close(0, "")`
     */
    close(code?: number, reason?: string): void;

    /**
     * Send a message to all subscribers of a topic
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
     * ws.publish("chat", "Hello World");
     * ```
     *
     * @example
     * ```js
     * ws.publish("chat", new Uint8Array([1, 2, 3, 4]));
     * ```
     *
     * @example
     * ```js
     * ws.publish("chat", new ArrayBuffer(4), true);
     * ```
     *
     * @example
     * ```js
     * ws.publish("chat", new DataView(new ArrayBuffer(4)));
     * ```
     */
    publish(
      topic: string,
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      compress?: boolean,
    ): ServerWebSocketSendStatus;

    /**
     * Send a message to all subscribers of a topic
     *
     * This function is the same as {@link publish} but only accepts string input. This function has a fast path.
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
     * ws.publishText("chat", "Hello World");
     * ```
     *
     */
    publishText(
      topic: string,
      data: string,
      compress?: boolean,
    ): ServerWebSocketSendStatus;

    /**
     * Send a message to all subscribers of a topic
     *
     * This function is the same as {@link publish} but only accepts a Uint8Array. This function has a fast path.
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
     * ws.publishBinary("chat", "Hello World");
     * ```
     *
     * @example
     * ```js
     * ws.publishBinary("chat", new Uint8Array([1, 2, 3, 4]));
     * ```
     *
     * @example
     * ```js
     * ws.publishBinary("chat", new ArrayBuffer(4), true);
     * ```
     *
     * @example
     * ```js
     * ws.publishBinary("chat", new DataView(new ArrayBuffer(4)));
     * ```
     */
    publishBinary(
      topic: string,
      data: Uint8Array,
      compress?: boolean,
    ): ServerWebSocketSendStatus;

    /**
     * Subscribe to a topic
     * @param topic The topic to subscribe to
     *
     * @example
     * ```js
     * ws.subscribe("chat");
     * ```
     */
    subscribe(topic: string): void;

    /**
     * Unsubscribe from a topic
     * @param topic The topic to unsubscribe from
     *
     * @example
     * ```js
     * ws.unsubscribe("chat");
     * ```
     *
     */
    unsubscribe(topic: string): void;

    /**
     * Is the socket subscribed to a topic?
     * @param topic The topic to check
     *
     * @returns `true` if the socket is subscribed to the topic, `false` otherwise
     */
    isSubscribed(topic: string): boolean;

    /**
     * The remote address of the client
     * @example
     * ```js
     * console.log(socket.remoteAddress); // "127.0.0.1"
     * ```
     */
    readonly remoteAddress: string;

    /**
     * Ready state of the socket
     *
     * @example
     * ```js
     * console.log(socket.readyState); // 1
     * ```
     */
    readonly readyState: -1 | 0 | 1 | 2 | 3;

    /**
     * The data from the {@link Server.upgrade} function
     *
     * Put any data you want to share between the `fetch` function and the websocket here.
     *
     * You can read/write to this property at any time.
     */
    data: T;

    /**
     * Batch data sent to a {@link ServerWebSocket}
     *
     * This makes it significantly faster to {@link ServerWebSocket.send} or {@link ServerWebSocket.publish} multiple messages
     *
     * The `message`, `open`, and `drain` callbacks are automatically corked, so
     * you only need to call this if you are sending messages outside of those
     * callbacks or in async functions
     */
    cork: (callback: (ws: ServerWebSocket<T>) => any) => void | Promise<void>;

    /**
     * Configure the {@link WebSocketHandler.message} callback to return a {@link ArrayBuffer} instead of a {@link Uint8Array}
     *
     * @default "uint8array"
     */
    binaryType?: "arraybuffer" | "uint8array";
  }

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
   * @example
   * ```ts
   * import { websocket, serve } from "bun";
   *
   * serve({
   *   port: 3000,
   *   websocket: websocket<{name: string}>({
   *     open: (ws) => {
   *       console.log("Client connected");
   *    },
   *     message: (ws, message) => {
   *       console.log(`${ws.data.name}: ${message}`);
   *    },
   *     close: (ws) => {
   *       console.log("Client disconnected");
   *    },
   *  }),
   *
   *   fetch(req, server) {
   *     if (req.url === "/chat") {
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
   */
  export interface WebSocketHandler<T = undefined> {
    /**
     * Handle an incoming message to a {@link ServerWebSocket}
     *
     * @param ws The {@link ServerWebSocket} that received the message
     * @param message The message received
     *
     * To change `message` to be an `ArrayBuffer` instead of a `Uint8Array`, set `ws.binaryType = "arraybuffer"`
     */
    message: (
      ws: ServerWebSocket<T>,
      message: string | Uint8Array,
    ) => void | Promise<void>;

    /**
     * The {@link ServerWebSocket} has been opened
     *
     * @param ws The {@link ServerWebSocket} that was opened
     */
    open?: (ws: ServerWebSocket<T>) => void | Promise<void>;
    /**
     * The {@link ServerWebSocket} is ready for more data
     *
     * @param ws The {@link ServerWebSocket} that is ready
     */
    drain?: (ws: ServerWebSocket<T>) => void | Promise<void>;
    /**
     * The {@link ServerWebSocket} is being closed
     * @param ws The {@link ServerWebSocket} that was closed
     * @param code The close code
     * @param message The close message
     */
    close?: (
      ws: ServerWebSocket<T>,
      code: number,
      message: string,
    ) => void | Promise<void>;
    /**
     * Enable compression for clients that support it. By default, compression is disabled.
     *
     * @default false
     *
     * `true` is equivalent to `"shared"
     */
    perMessageDeflate?:
      | true
      | false
      | {
          /**
           * Enable compression on the {@link ServerWebSocket}
           *
           * @default false
           *
           * `true` is equivalent to `"shared"
           */
          compress?: WebSocketCompressor | false | true;
          /**
           * Configure decompression
           *
           * @default false
           *
           * `true` is equivalent to `"shared"
           */
          decompress?: WebSocketCompressor | false | true;
        };

    /**
     * The maximum size of a message
     */
    maxPayloadLength?: number;
    /**
     * After a connection has not received a message for this many seconds, it will be closed.
     * @default 120 (2 minutes)
     */
    idleTimeout?: number;
    /**
     * The maximum number of bytes that can be buffered for a single connection.
     * @default 16MB
     */
    backpressureLimit?: number;
    /**
     * Close the connection if the backpressure limit is reached.
     * @default false
     * @see {@link backpressureLimit}
     * @see {@link ServerWebSocketSendStatus}
     * @see {@link ServerWebSocket.send}
     * @see {@link ServerWebSocket.publish}
     */
    closeOnBackpressureLimit?: boolean;

    /**
     * Control whether or not ws.publish() should include the ServerWebSocket
     * that published the message. This is enabled by default, but it was an API
     * design mistake. A future version of Bun will change this default to
     * `false` and eventually remove this option entirely. The better way to publish to all is to use {@link Server.publish}.
     *
     * if `true` or `undefined`, {@link ServerWebSocket.publish} will publish to all subscribers, including the websocket publishing the message.
     *
     * if `false`, {@link ServerWebSocket.publish} will publish to all subscribers excluding the websocket publishing the message.
     *
     * @default true
     *
     */
    publishToSelf?: boolean;
  }

  interface GenericServeOptions {
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
     * What URI should be used to make {@link Request.url} absolute?
     *
     * By default, looks at {@link hostname}, {@link port}, and whether or not SSL is enabled to generate one
     *
     * @example
     *```js
     * "http://my-app.com"
     * ```
     *
     * @example
     *```js
     * "https://wongmjane.com/"
     * ```
     *
     * This should be the public, absolute URL – include the protocol and {@link hostname}. If the port isn't 80 or 443, then include the {@link port} too.
     *
     * @example
     * "http://localhost:3000"
     *
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
    development?: boolean;

    error?: (
      this: Server,
      request: Errorlike,
    ) => Response | Promise<Response> | undefined | void | Promise<undefined>;
  }

  export type AnyFunction = (..._: any[]) => any;
  export interface ServeOptions extends GenericServeOptions {
    /**
     * Handle HTTP requests
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     *
     */
    fetch(
      this: Server,
      request: Request,
      server: Server,
    ): Response | Promise<Response>;
  }

  export interface WebSocketServeOptions<WebSocketDataType = undefined>
    extends GenericServeOptions {
    /**
     * Enable websockets with {@link Bun.serve}
     *
     * For simpler type safety, see {@link Bun.websocket}
     *
     * @example
     * ```js
     *import { serve, websocket } from "bun";
     *serve({
     *  websocket: websocket({
     *    open: (ws) => {
     *      console.log("Client connected");
     *    },
     *    message: (ws, message) => {
     *      console.log("Client sent message", message);
     *    },
     *    close: (ws) => {
     *      console.log("Client disconnected");
     *    },
     *  }),
     *  fetch(req, server) {
     *    if (req.url === "/chat") {
     *      const upgraded = server.upgrade(req);
     *      if (!upgraded) {
     *        return new Response("Upgrade failed", { status: 400 });
     *      }
     *    }
     *    return new Response("Hello World");
     *  },
     *});
     *```
     * Upgrade a {@link Request} to a {@link ServerWebSocket} via {@link Server.upgrade}
     *
     * Pass `data` in @{link Server.upgrade} to attach data to the {@link ServerWebSocket.data} property
     *
     *
     */
    websocket: WebSocketHandler<WebSocketDataType>;

    /**
     * Handle HTTP requests or upgrade them to a {@link ServerWebSocket}
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     *
     */
    fetch(
      this: Server,
      request: Request,
      server: Server,
    ): Response | undefined | Promise<Response | undefined>;
  }

  export interface TLSWebSocketServeOptions<WebSocketDataType = undefined>
    extends WebSocketServeOptions<WebSocketDataType>,
      TLSOptions {}
  export interface Errorlike extends Error {
    code?: string;
    errno?: number;
    syscall?: string;
  }

  interface TLSOptions {
    /**
     * File path to a TLS key
     *
     * To enable TLS, this option is required.
     */
    keyFile: string;
    /**
     * File path to a TLS certificate
     *
     * To enable TLS, this option is required.
     */
    certFile: string;

    /**
     * Passphrase for the TLS key
     */
    passphrase?: string;
    /**
     *  File path to a .pem file for a custom root CA
     */
    caFile?: string;

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
  }

  export interface TLSServeOptions extends ServeOptions, TLSOptions {
    /**
     *  The keys are [SNI](https://en.wikipedia.org/wiki/Server_Name_Indication) hostnames.
     *  The values are SSL options objects.
     */
    serverNames?: Record<string, TLSOptions>;
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
   * Powered by a fork of [uWebSockets](https://github.com/uNetworking/uWebSockets). Thank you @alexhultman.
   *
   */
  export interface Server {
    /**
     * Stop listening to prevent new connections from being accepted.
     *
     * By default, it does not cancel in-flight requests or websockets. That means it may take some time before all network activity stops.
     *
     * @param closeActiveConnections Immediately terminate in-flight requests, websockets, and stop accepting new connections.
     * @default false
     */
    stop(closeActiveConnections?: boolean): void;

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
     * server.update({
     *   fetch(request) {
     *     return new Response("Hello World v2")
     *   }
     * });
     * ```
     *
     * Passing other options such as `port` or `hostname` won't do anything.
     */
    reload(options: Serve): void;

    /**
     * Mock the fetch handler for a running server.
     *
     * This feature is not fully implemented yet. It doesn't normalize URLs
     * consistently in all cases and it doesn't yet call the `error` handler
     * consistently. This needs to be fixed
     */
    fetch(request: Request): Response | Promise<Response>;

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
     * import { serve, websocket } from "bun";
     *  serve({
     *    websocket: websocket({
     *      open: (ws) => {
     *        console.log("Client connected");
     *      },
     *      message: (ws, message) => {
     *        console.log("Client sent message", message);
     *      },
     *      close: (ws) => {
     *        console.log("Client disconnected");
     *      },
     *    }),
     *    fetch(req, server) {
     *      if (req.url === "/chat") {
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
     *
     */
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
     * How many requests are in-flight right now?
     */
    readonly pendingRequests: number;

    /**
     * How many {@link ServerWebSocket}s are in-flight right now?
     */
    readonly pendingWebSockets: number;

    readonly port: number;
    /**
     * The hostname the server is listening on. Does not include the port
     * @example
     * ```js
     * "localhost"
     * ```
     */
    readonly hostname: string;
    /**
     * Is the server running in development mode?
     *
     * In development mode, `Bun.serve()` returns rendered error messages with
     * stack traces instead of a generic 500 error. This makes debugging easier,
     * but development mode shouldn't be used in production or you will risk
     * leaking sensitive information.
     *
     */
    readonly development: boolean;
  }

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
   * @param path The path to the file (lazily loaded)
   *
   */
  // tslint:disable-next-line:unified-signatures
  export function file(path: string | URL, options?: BlobPropertyBag): BunFile;

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
   * @param path The path to the file as a byte buffer (the buffer is copied)
   */
  // tslint:disable-next-line:unified-signatures
  export function file(
    path: ArrayBufferLike | Uint8Array,
    options?: BlobPropertyBag,
  ): BunFile;

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
  // tslint:disable-next-line:unified-signatures
  export function file(
    fileDescriptor: number,
    options?: BlobPropertyBag,
  ): BunFile;

  /**
   * Allocate a new [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) without zeroing the bytes.
   *
   * This can be 3.5x faster than `new Uint8Array(size)`, but if you send uninitialized memory to your users (even unintentionally), it can potentially leak anything recently in memory.
   */
  export function allocUnsafe(size: number): Uint8Array;

  /**
   * Pretty-print an object the same as {@link console.log} to a `string`
   *
   * Supports JSX
   *
   * @param args
   */
  export function inspect(...args: any): string;

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
   *
   */
  export function mmap(path: PathLike, opts?: MMapOptions): Uint8Array;

  /** Write to stdout */
  const stdout: BunFile;
  /** Write to stderr */
  const stderr: BunFile;
  /**
   * Read from stdin
   *
   * This is read-only
   */
  const stdin: BunFile;

  interface unsafe {
    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint8Array` or `ArrayBuffer`.
     *
     * **Only use this for ASCII strings**. If there are non-ascii characters, your application may crash and/or very confusing bugs will happen such as `"foo" !== "foo"`.
     *
     * **The input buffer must not be garbage collected**. That means you will need to hold on to it for the duration of the string's lifetime.
     *
     */
    arrayBufferToString(buffer: Uint8Array | ArrayBufferLike): string;

    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint16Array`
     *
     * **The input must be a UTF-16 encoded string**. This API does no validation whatsoever.
     *
     * **The input buffer must not be garbage collected**. That means you will need to hold on to it for the duration of the string's lifetime.
     *
     */
    // tslint:disable-next-line:unified-signatures
    arrayBufferToString(buffer: Uint16Array): string;

    /** Mock bun's segfault handler. You probably don't want to use this */
    segfault(): void;

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
    gcAggressionLevel(level?: 0 | 1 | 2): 0 | 1 | 2;
  }
  export const unsafe: unsafe;

  type DigestEncoding = "hex" | "base64";

  /**
   * Are ANSI colors enabled for stdin and stdout?
   *
   * Used for {@link console.log}
   */
  export const enableANSIColors: boolean;

  /**
   * What script launched bun?
   *
   * Absolute file path
   *
   * @example "/never-gonna-give-you-up.js"
   */
  export const main: string;

  /**
   * Manually trigger the garbage collector
   *
   * This does two things:
   * 1. It tells JavaScriptCore to run the garbage collector
   * 2. It tells [mimalloc](https://github.com/microsoft/mimalloc) to clean up fragmented memory. Mimalloc manages the heap not used in JavaScriptCore.
   *
   * @param force Synchronously run the garbage collector
   */
  export function gc(force: boolean): void;

  /**
   * JavaScriptCore engine's internal heap snapshot
   *
   * I don't know how to make this something Chrome or Safari can read.
   *
   * If you have any ideas, please file an issue https://github.com/oven-sh/bun
   */
  interface HeapSnapshot {
    /** "2" */
    version: string;

    /** "Inspector" */
    type: string;

    nodes: number[];

    nodeClassNames: string[];
    edges: number[];
    edgeTypes: string[];
    edgeNames: string[];
  }

  /**
   * Nanoseconds since Bun.js was started as an integer.
   *
   * This uses a high-resolution monotonic system timer.
   *
   * After 14 weeks of consecutive uptime, this function
   * wraps
   */
  export function nanoseconds(): number;

  /**
   * Generate a heap snapshot for seeing where the heap is being used
   */
  export function generateHeapSnapshot(): HeapSnapshot;

  /**
   * The next time JavaScriptCore is idle, clear unused memory and attempt to reduce the heap size.
   */
  export function shrink(): void;

  /**
   * Open a file in your local editor. Auto-detects via `$VISUAL` || `$EDITOR`
   *
   * @param path path to open
   */
  export function openInEditor(path: string, options?: EditorOptions): void;

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
    update(data: StringOrBuffer): T;

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
    digest(hashInto?: TypedArray): TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    static hash(input: StringOrBuffer, hashInto?: TypedArray): TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param encoding `DigestEncoding` to return the hash in
     */
    static hash(input: StringOrBuffer, encoding: DigestEncoding): string;
  }

  type SupportedCryptoAlgorithms =
    | "blake2b256"
    | "md4"
    | "md5"
    | "ripemd160"
    | "sha1"
    | "sha224"
    | "sha256"
    | "sha384"
    | "sha512"
    | "sha512-256";
  /**
   * Hardware-accelerated cryptographic hash functions
   *
   * Used for `crypto.createHash()`
   */
  export class CryptoHasher {
    /**
     * The algorithm chosen to hash the data
     *
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
     */
    constructor(algorithm: SupportedCryptoAlgorithms);

    /**
     * Update the hash with data
     *
     * @param input
     */
    update(input: StringOrBuffer, inputEncoding?: CryptoEncoding): CryptoHasher;

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
    digest(hashInto?: TypedArray): TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    static hash(
      algorithm: SupportedCryptoAlgorithms,
      input: StringOrBuffer,
      hashInto?: TypedArray,
    ): TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param encoding `DigestEncoding` to return the hash in
     */
    static hash(
      algorithm: SupportedCryptoAlgorithms,
      input: StringOrBuffer,
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
  export function sleep(ms: number | Date): Promise<void>;

  /**
   * Sleep the thread for a given number of milliseconds
   *
   * This is a blocking function.
   *
   * Internally, it calls [nanosleep(2)](https://man7.org/linux/man-pages/man2/nanosleep.2.html)
   */
  export function sleepSync(ms: number): void;

  /**
   *
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
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
   *```
   */
  export function sha(input: StringOrBuffer, hashInto?: Uint8Array): Uint8Array;

  /**
   *
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
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
   *```
   */
  export function sha(input: StringOrBuffer, encoding: DigestEncoding): string;

  /**
   * This is not the default because it's not cryptographically secure and it's slower than {@link SHA512}
   *
   * Consider using the ugly-named {@link SHA512_256} instead
   */
  export class SHA1 extends CryptoHashInterface<SHA1> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 20;
  }
  export class MD5 extends CryptoHashInterface<MD5> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 16;
  }
  export class MD4 extends CryptoHashInterface<MD4> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 16;
  }
  export class SHA224 extends CryptoHashInterface<SHA224> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 28;
  }
  export class SHA512 extends CryptoHashInterface<SHA512> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 64;
  }
  export class SHA384 extends CryptoHashInterface<SHA384> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 48;
  }
  export class SHA256 extends CryptoHashInterface<SHA256> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 32;
  }
  /**
   * See also {@link sha}
   */
  export class SHA512_256 extends CryptoHashInterface<SHA512_256> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 32;
  }

  /** Compression options for `Bun.deflateSync` and `Bun.gzipSync` */
  export type ZlibCompressionOptions = {
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
  };

  /**
   * Compresses a chunk of data with `zlib` DEFLATE algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  export function deflateSync(
    data: Uint8Array,
    options?: ZlibCompressionOptions,
  ): Uint8Array;
  /**
   * Compresses a chunk of data with `zlib` GZIP algorithm.
   * @param data The buffer of data to compress
   * @param options Compression options to use
   * @returns The output buffer with the compressed data
   */
  export function gzipSync(
    data: Uint8Array,
    options?: ZlibCompressionOptions,
  ): Uint8Array;
  /**
   * Decompresses a chunk of data with `zlib` INFLATE algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  export function inflateSync(data: Uint8Array): Uint8Array;
  /**
   * Decompresses a chunk of data with `zlib` GUNZIP algorithm.
   * @param data The buffer of data to decompress
   * @returns The output buffer with the decompressed data
   */
  export function gunzipSync(data: Uint8Array): Uint8Array;

  export type PluginTarget =
    /**
     * The default environment when using `bun run` or `bun` to load a script
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
    loader: "js" | "jsx" | "ts" | "tsx" | "json" | "toml";
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
  }

  type OnLoadResult = OnLoadResultSourceCode | OnLoadResultObject;
  type OnLoadCallback = (
    args: OnLoadArgs,
  ) => OnLoadResult | Promise<OnLoadResult>;

  interface OnResolveArgs {
    /**
     * The import specifier of the module being loaded
     */
    path: string;
    /**
     * The module that imported the module being resolved
     */
    importer: string;
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
  }

  type OnResolveCallback = (args: OnResolveArgs) => OnResolveResult | void;

  interface PluginBuilder {
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
     */
    onLoad(constraints: PluginConstraints, callback: OnLoadCallback): void;
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
     */
    onResolve(
      constraints: PluginConstraints,
      callback: OnResolveCallback,
    ): void;
    /**
     * The current target environment
     */
    target: PluginTarget;
  }

  interface BunPlugin {
    /**
     * Human-readable name of the plugin
     *
     * In a future version of Bun, this will be used in error messages.
     */
    name?: string;

    /**
     * The target JavaScript environment the plugin should be applied to.
     * - `bun`: The default environment when using `bun run` or `bun` to load a script
     * - `browser`: The plugin will be applied to browser builds
     * - `node`: The plugin will be applied to Node.js builds
     *
     * If in Bun's runtime, the default target is `bun`.
     *
     * If unspecified, it is assumed that the plugin is compatible with the default target.
     */
    target?: PluginTarget;
    /**
     * A function that will be called when the plugin is loaded.
     *
     * This function may be called in the same tick that it is registered, or it may be called later. It could potentially be called multiple times for different targets.
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
      builder: PluginBuilder,
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
   *
   * @example
   * A YAML loader plugin
   *
   * ```js
   *Bun.plugin({
   *  setup(builder) {
   *   builder.onLoad({ filter: /\.yaml$/ }, ({path}) => ({
   *     loader: "object",
   *     exports: require("js-yaml").load(fs.readFileSync(path, "utf8"))
   *   }));
   *});
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

  interface Socket<Data = undefined> {
    /**
     * Write `data` to the socket
     *
     * @param data The data to write to the socket
     * @param byteOffset The offset in the buffer to start writing from (defaults to 0)
     * @param byteLength The number of bytes to write (defaults to the length of the buffer)
     *
     * When passed a string, `byteOffset` and `byteLength` refer to the UTF-8 offset, not the string character offset.
     *
     * This is unbuffered as of Bun v0.2.2. That means individual write() calls
     * will be slow. In the future, Bun will buffer writes and flush them at the
     * end of the tick, when the event loop is idle, or sooner if the buffer is full.
     */
    write(
      data: string | BufferSource,
      byteOffset?: number,
      byteLength?: number,
    ): number;

    /**
     * The data context for the socket.
     */
    data: Data;

    /**
     * Like {@link Socket.write} except it includes a TCP FIN packet
     *
     * Use it to send your last message and close the connection.
     */
    end(
      data?: string | BufferSource,
      byteOffset?: number,
      byteLength?: number,
    ): number;

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
     * Shutdown writes to a socket
     *
     * This makes the socket a half-closed socket. It can still receive data.
     *
     * This calls [shutdown(2)](https://man7.org/linux/man-pages/man2/shutdown.2.html) internally
     */
    shutdown(halfClose?: boolean): void;

    readonly readyState: "open" | "closing" | "closed";

    /**
     * Allow Bun's process to exit even if this socket is still open
     *
     * After the socket has closed, this function does nothing.
     */
    unref(): void;

    /**
     * Flush any buffered data to the socket
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

    /**
     * Remote IP address connected to the socket
     */
    readonly remoteAddress: string;

    /**
     * local port connected to the socket
     */
    readonly localPort: number;
  }

  interface SocketListener<Data = undefined> {
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

  type BinaryTypeList = {
    arraybuffer: ArrayBuffer;
    buffer: Buffer;
    uint8array: Uint8Array;
    // TODO: DataView
    // dataview: DataView;
  };
  type BinaryType = keyof BinaryTypeList;

  interface SocketHandler<
    Data = unknown,
    DataBinaryType extends BinaryType = "buffer",
  > {
    /**
     * Is called when the socket connects, or in case of TLS if no handshake is provided
     * this will be called only after handshake
     * @param socket
     */
    open?(socket: Socket<Data>): void | Promise<void>;
    close?(socket: Socket<Data>): void | Promise<void>;
    error?(socket: Socket<Data>, error: Error): void | Promise<void>;
    data?(
      socket: Socket<Data>,
      data: BinaryTypeList[DataBinaryType],
    ): void | Promise<void>;
    drain?(socket: Socket<Data>): void | Promise<void>;

    /**
     * When handshake is completed, this functions is called.
     * @param socket
     * @param success Indicates if the server authorized despite the authorizationError.
     * @param authorizationError Certificate Authorization Error or null.
     */
    handshake?(
      socket: Socket<Data>,
      success: boolean,
      authorizationError: Error | null,
    ): void;

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
     *
     */
    binaryType?: BinaryType;
  }

  interface SocketOptions<Data = unknown> {
    socket: SocketHandler<Data>;
    data?: Data;
  }
  // interface TCPSocketOptions<Data = undefined> extends SocketOptions<Data> {
  //   hostname: string;
  //   port: number;
  // }

  interface TCPSocketListenOptions<Data = undefined>
    extends SocketOptions<Data> {
    hostname: string;
    port: number;
    tls?: TLSOptions;
  }

  interface TCPSocketConnectOptions<Data = undefined>
    extends SocketOptions<Data> {
    hostname: string;
    port: number;
    tls?: boolean;
  }

  interface UnixSocketOptions<Data = undefined> extends SocketOptions<Data> {
    unix: string;
  }

  /**
   *
   * Create a TCP client that connects to a server
   *
   * @param options The options to use when creating the client
   * @param options.socket The socket handler to use
   * @param options.data The per-instance data context
   * @param options.hostname The hostname to connect to
   * @param options.port The port to connect to
   * @param options.tls The TLS configuration object
   * @param options.unix The unix socket to connect to
   *
   */
  export function connect<Data = undefined>(
    options: TCPSocketConnectOptions<Data>,
  ): Promise<TCPSocketListener<typeof options>>;
  export function connect<Data = undefined>(
    options: UnixSocketOptions<Data>,
  ): Promise<UnixSocketListener<typeof options>>;

  /**
   *
   * Create a TCP server that listens on a port
   *
   * @param options The options to use when creating the server
   * @param options.socket The socket handler to use
   * @param options.data The per-instance data context
   * @param options.hostname The hostname to connect to
   * @param options.port The port to connect to
   * @param options.tls The TLS configuration object
   * @param options.unix The unix socket to connect to
   *
   */
  export function listen<Data = undefined>(
    options: TCPSocketListenOptions<Data>,
  ): TCPSocketListener<Data>;
  export function listen<Data = undefined>(
    options: UnixSocketOptions<Data>,
  ): UnixSocketListener<Data>;

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

    interface OptionsObject<
      In extends Writable = Writable,
      Out extends Readable = Readable,
      Err extends Readable = Readable,
    > {
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
       *
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
       * - `"pipe"`, `undefined`: The process will have a {@link ReadableStream} for standard output/error
       * - `"ignore"`, `null`: The process will have no standard output/error
       * - `"inherit"`: The process will inherit the standard output/error of the current process
       * - `ArrayBufferView`: The process write to the preallocated buffer. Not implemented.
       * - `number`: The process will write to the file descriptor
       *
       * @default ["ignore", "pipe", "inherit"] for `spawn`
       * ["ignore", "pipe", "pipe"] for `spawnSync`
       */
      stdio?: [In, Out, Err];
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
       * - `"pipe"`, `undefined`: The process will have a {@link ReadableStream} for standard output/error
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
       * - `"pipe"`, `undefined`: The process will have a {@link ReadableStream} for standard output/error
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
        error?: Errorlike,
      ): void | Promise<void>;
    }

    type OptionsToSubprocess<Opts extends OptionsObject> =
      Opts extends OptionsObject<infer In, infer Out, infer Err>
        ? Subprocess<
            // "Writable extends In" means "if In === Writable",
            // aka if true that means the user didn't specify anything
            Writable extends In ? "ignore" : In,
            Readable extends Out ? "pipe" : Out,
            Readable extends Err ? "inherit" : Err
          >
        : Subprocess<Writable, Readable, Readable>;

    type OptionsToSyncSubprocess<Opts extends OptionsObject> =
      Opts extends OptionsObject<any, infer Out, infer Err>
        ? SyncSubprocess<
            Readable extends Out ? "pipe" : Out,
            Readable extends Err ? "pipe" : Err
          >
        : SyncSubprocess<Readable, Readable>;

    type ReadableIO = ReadableStream<Buffer> | number | undefined;

    type ReadableToIO<X extends Readable> = X extends "pipe" | undefined
      ? ReadableStream<Buffer>
      : X extends BunFile | ArrayBufferView | number
      ? number
      : undefined;

    type ReadableToSyncIO<X extends Readable> = X extends "pipe" | undefined
      ? Buffer
      : undefined;

    type WritableIO = FileSink | number | undefined;

    type WritableToIO<X extends Writable> = X extends "pipe"
      ? FileSink
      : X extends BunFile | ArrayBufferView | Blob | Request | Response | number
      ? number
      : undefined;
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
  > {
    readonly stdin: SpawnOptions.WritableToIO<In>;
    readonly stdout: SpawnOptions.ReadableToIO<Out>;
    readonly stderr: SpawnOptions.ReadableToIO<Err>;

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
    readonly signalCode: Signals | null;

    /**
     * Has the process exited?
     */
    readonly killed: boolean;

    /**
     * Kill the process
     * @param exitCode The exitCode to send to the process
     */
    kill(exitCode?: number): void;

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
  }

  /**
   * Spawn a new process
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
  function spawn<Opts extends SpawnOptions.OptionsObject>(
    options: Opts & {
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
  ): SpawnOptions.OptionsToSubprocess<Opts>;

  /**
   * Spawn a new process
   *
   * ```js
   * const {stdout} = Bun.spawn(["echo", "hello"]));
   * const text = await readableStreamToText(stdout);
   * console.log(text); // "hello\n"
   * ```
   *
   * Internally, this uses [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
   */
  function spawn<Opts extends SpawnOptions.OptionsObject>(
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
    options?: Opts,
  ): SpawnOptions.OptionsToSubprocess<Opts>;

  /**
   * Spawn a new process
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
  function spawnSync<Opts extends SpawnOptions.OptionsObject>(
    options: Opts & {
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
    },
  ): SpawnOptions.OptionsToSyncSubprocess<Opts>;

  /**
   * Synchronously spawn a new process
   *
   * ```js
   * const {stdout} = Bun.spawnSync(["echo", "hello"]));
   * console.log(stdout.toString()); // "hello\n"
   * ```
   *
   * Internally, this uses [posix_spawn(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/posix_spawn.2.html)
   */
  function spawnSync<Opts extends SpawnOptions.OptionsObject>(
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
    options?: Opts,
  ): SpawnOptions.OptionsToSyncSubprocess<Opts>;

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

  export class FileSystemRouter {
    /**
     * Create a new {@link FileSystemRouter}.
     *
     * @example
     * ```ts
     *const router = new FileSystemRouter({
     *   dir: process.cwd() + "/pages",
     *   style: "nextjs",
     *});
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

  export interface MatchedRoute {
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
   * "0.2.0"
   */
  export const version: string;

  /**
   * The git sha at the time the currently-running version of Bun was compiled
   * @example
   * "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   */
  export const revision: string;

  /**
   * Find the index of a newline character in potentially ill-formed UTF-8 text.
   *
   * This is sort of like readline() except without the IO.
   */
  export function indexOfLine(
    buffer: ArrayBufferView | ArrayBufferLike,
    offset?: number,
  ): number;
}

type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

type TimeLike = string | number | Date;
type StringOrBuffer = string | TypedArray | ArrayBufferLike;
type PathLike = string | TypedArray | ArrayBufferLike | URL;
type PathOrFileDescriptor = PathLike | number;
type NoParamCallback = (err: ErrnoException | null) => void;
type BufferEncoding =
  | "buffer"
  | "utf8"
  | "utf-8"
  | "ascii"
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "latin1"
  | "binary"
  | "hex"
  | "base64"
  | "base64url";

interface BufferEncodingOption {
  encoding?: BufferEncoding;
}

declare var Bun: typeof import("bun");
