// Type definitions for bun 0.0
// Project: https://github.com/oven-sh/bun
// Definitions by: Jarred Sumner <https://github.com/Jarred-Sumner>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

// This file is bundled so that your TypeScript editor integration loads it faster.
// ./bun.d.ts

interface VoidFunction {
  (): void;
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
  /**
   * Start a fast HTTP server.
   *
   * @param options Server options (port defaults to $PORT || 8080)
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
  export function serve(options: Serve): Server;

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
    destination: FileBlob | PathLike,
    input: Blob | TypedArray | string | BlobPart[]
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
  export function write(
    destination: FileBlob,
    input: Response
  ): Promise<number>;

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
    input: Response
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
  export function write(
    destination: FileBlob,
    input: FileBlob
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
    input: FileBlob
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
    buffers: Array<ArrayBufferView | ArrayBufferLike>
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
    stream: ReadableStream
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
    stream: ReadableStream
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

    write(chunk: string | ArrayBufferView | ArrayBuffer): number;
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
  export interface FileBlob extends Blob {
    /**
     * Offset any operation on the file starting at `begin` and ending at `end`. `end` is relative to 0
     *
     * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray). Does not copy the file, open the file, or modify the file.
     *
     * If `begin` > 0, {@link Bun.write()} will be slower on macOS
     *
     * @param begin - start offset in bytes
     * @param end - absolute offset in bytes (relative to 0)
     */
    slice(begin?: number, end?: number): FileBlob;
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
    data: string | ArrayBufferView | ArrayBuffer,
    seed?: number
  ) => number | bigint) &
    Hash;

  interface Hash {
    wyhash: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    crc32: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    adler32: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    cityHash32: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    cityHash64: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    murmur32v3: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    murmur64v2: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
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
    tsconfig?: string;

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
    macros?: MacroMap;

    autoImportJSX?: boolean;
    allowBunRuntime?: boolean;
    exports?: {
      eliminate?: string[];
      replace?: Record<string, string>;
    };
    treeShaking?: boolean;
    trimUnusedImports?: boolean;
    jsxOptimizationInline?: boolean;
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
    constructor(options: TranspilerOptions);

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
      ctx: object
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
    transformSync(code: StringOrBuffer, loader: JavaScriptLoader): string;

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

  export interface ServeOptions {
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
    baseURI?: string;

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

    /**
     * Handle HTTP requests
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     *
     */
    fetch(this: Server, request: Request): Response | Promise<Response>;

    error?: (
      this: Server,
      request: Errorlike
    ) => Response | Promise<Response> | undefined | Promise<undefined>;
  }

  export interface Errorlike extends Error {
    code?: string;
    errno?: number;
    syscall?: string;
  }

  export interface SSLAdvancedOptions {
    passphrase?: string;
    caFile?: string;
    dhParamsFile?: string;

    /**
     * This sets `OPENSSL_RELEASE_BUFFERS` to 1.
     * It reduces overall performance but saves some memory.
     * @default false
     */
    lowMemoryMode?: boolean;
  }
  interface SSLOptions {
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
  }

  export type SSLServeOptions = ServeOptions &
    SSLOptions &
    SSLAdvancedOptions & {
      /**
       *  The keys are [SNI](https://en.wikipedia.org/wiki/Server_Name_Indication) hostnames.
       *  The values are SSL options objects.
       */
      serverNames: Record<string, SSLOptions & SSLAdvancedOptions>;
    };

  /**
   * HTTP & HTTPS Server
   *
   * To start the server, see {@link serve}
   *
   * Often, you don't need to interact with this object directly. It exists to help you with the following tasks:
   * - Stop the server
   * - How many requests are currently being handled?
   *
   * For performance, Bun pre-allocates most of the data for 2048 concurrent requests.
   * That means starting a new server allocates about 500 KB of memory. Try to
   * avoid starting and stopping the server often (unless it's a new instance of bun).
   *
   * Powered by a fork of [uWebSockets](https://github.com/uNetworking/uWebSockets). Thank you @alexhultman.
   *
   */
  interface Server {
    /**
     * Stop listening to prevent new connections from being accepted.
     *
     * It does not close existing connections.
     *
     * It may take a second or two to actually stop.
     */
    stop(): void;

    /**
     * How many requests are in-flight right now?
     */
    readonly pendingRequests: number;
    readonly port: number;
    readonly hostname: string;
    readonly development: boolean;
  }

  export type Serve = SSLServeOptions | ServeOptions;

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
  export function file(path: string, options?: BlobPropertyBag): FileBlob;

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
    options?: BlobPropertyBag
  ): FileBlob;

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
    options?: BlobPropertyBag
  ): FileBlob;

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
  const stdout: FileBlob;
  /** Write to stderr */
  const stderr: FileBlob;
  /**
   * Read from stdin
   *
   * This is read-only
   */
  const stdin: FileBlob;

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
  | Float64Array;
type TimeLike = string | number | Date;
type StringOrBuffer = string | TypedArray | ArrayBufferLike;
type PathLike = string | TypedArray | ArrayBufferLike;
type PathOrFileDescriptor = PathLike | number;
type NoParamCallback = VoidFunction;
type BufferEncoding =
  | "buffer"
  | "utf8"
  | "utf-8"
  | "ascii"
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "latin1"
  | "binary";

interface BufferEncodingOption {
  encoding?: BufferEncoding;
}

declare var Bun: typeof import("bun");


// ./buffer.d.ts

/**
 * `Buffer` objects are used to represent a fixed-length sequence of bytes. Many
 * Node.js APIs support `Buffer`s.
 *
 * The `Buffer` class is a subclass of JavaScript's [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) class and
 * extends it with methods that cover additional use cases. Node.js APIs accept
 * plain [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) s wherever `Buffer`s are supported as well.
 *
 * While the `Buffer` class is available within the global scope, it is still
 * recommended to explicitly reference it via an import or require statement.
 *
 * ```js
 * import { Buffer } from 'buffer';
 *
 * // Creates a zero-filled Buffer of length 10.
 * const buf1 = Buffer.alloc(10);
 *
 * // Creates a Buffer of length 10,
 * // filled with bytes which all have the value `1`.
 * const buf2 = Buffer.alloc(10, 1);
 *
 * // Creates an uninitialized buffer of length 10.
 * // This is faster than calling Buffer.alloc() but the returned
 * // Buffer instance might contain old data that needs to be
 * // overwritten using fill(), write(), or other functions that fill the Buffer's
 * // contents.
 * const buf3 = Buffer.allocUnsafe(10);
 *
 * // Creates a Buffer containing the bytes [1, 2, 3].
 * const buf4 = Buffer.from([1, 2, 3]);
 *
 * // Creates a Buffer containing the bytes [1, 1, 1, 1] – the entries
 * // are all truncated using `(value &#x26; 255)` to fit into the range 0–255.
 * const buf5 = Buffer.from([257, 257.5, -255, '1']);
 *
 * // Creates a Buffer containing the UTF-8-encoded bytes for the string 'tést':
 * // [0x74, 0xc3, 0xa9, 0x73, 0x74] (in hexadecimal notation)
 * // [116, 195, 169, 115, 116] (in decimal notation)
 * const buf6 = Buffer.from('tést');
 *
 * // Creates a Buffer containing the Latin-1 bytes [0x74, 0xe9, 0x73, 0x74].
 * const buf7 = Buffer.from('tést', 'latin1');
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/buffer.js)
 */
declare module 'buffer' {
  export const INSPECT_MAX_BYTES: number;
  export const kMaxLength: number;
  export type TranscodeEncoding = 'ascii' | 'utf8' | 'utf16le' | 'ucs2' | 'latin1' | 'binary';
  export const SlowBuffer: {
      /** @deprecated since v6.0.0, use `Buffer.allocUnsafeSlow()` */
      new (size: number): Buffer;
      prototype: Buffer;
  };
  export { Buffer };
  /**
   * @experimental
   */
  export interface BlobOptions {
      /**
       * @default 'utf8'
       */
      encoding?: BufferEncoding | undefined;
      /**
       * The Blob content-type. The intent is for `type` to convey
       * the MIME media type of the data, however no validation of the type format
       * is performed.
       */
      type?: string | undefined;
  }
  global {
      // Buffer class
      type WithImplicitCoercion<T> =
          | T
          | {
                valueOf(): T;
            };
      /**
       * Raw data is stored in instances of the Buffer class.
       * A Buffer is similar to an array of integers but corresponds to a raw memory allocation outside the V8 heap.  A Buffer cannot be resized.
       * Valid string encodings: 'ascii'|'utf8'|'utf16le'|'ucs2'(alias of 'utf16le')|'base64'|'base64url'|'binary'(deprecated)|'hex'
       */
      interface BufferConstructor {
          /**
           * Allocates a new buffer containing the given {str}.
           *
           * @param str String to store in buffer.
           * @param encoding encoding to use, optional.  Default is 'utf8'
           * @deprecated since v10.0.0 - Use `Buffer.from(string[, encoding])` instead.
           */
          new (str: string, encoding?: BufferEncoding): Buffer;
          /**
           * Allocates a new buffer of {size} octets.
           *
           * @param size count of octets to allocate.
           * @deprecated since v10.0.0 - Use `Buffer.alloc()` instead (also see `Buffer.allocUnsafe()`).
           */
          new (size: number): Buffer;
          /**
           * Allocates a new buffer containing the given {array} of octets.
           *
           * @param array The octets to store.
           * @deprecated since v10.0.0 - Use `Buffer.from(array)` instead.
           */
          new (array: Uint8Array): Buffer;
          /**
           * Produces a Buffer backed by the same allocated memory as
           * the given {ArrayBuffer}/{SharedArrayBuffer}.
           *
           *
           * @param arrayBuffer The ArrayBuffer with which to share memory.
           * @deprecated since v10.0.0 - Use `Buffer.from(arrayBuffer[, byteOffset[, length]])` instead.
           */
          new (arrayBuffer: ArrayBuffer | SharedArrayBuffer): Buffer;
          /**
           * Allocates a new buffer containing the given {array} of octets.
           *
           * @param array The octets to store.
           * @deprecated since v10.0.0 - Use `Buffer.from(array)` instead.
           */
          new (array: ReadonlyArray<any>): Buffer;
          /**
           * Copies the passed {buffer} data onto a new {Buffer} instance.
           *
           * @param buffer The buffer to copy.
           * @deprecated since v10.0.0 - Use `Buffer.from(buffer)` instead.
           */
          new (buffer: Buffer): Buffer;
          /**
           * Allocates a new `Buffer` using an `array` of bytes in the range `0` – `255`.
           * Array entries outside that range will be truncated to fit into it.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Creates a new Buffer containing the UTF-8 bytes of the string 'buffer'.
           * const buf = Buffer.from([0x62, 0x75, 0x66, 0x66, 0x65, 0x72]);
           * ```
           *
           * A `TypeError` will be thrown if `array` is not an `Array` or another type
           * appropriate for `Buffer.from()` variants.
           *
           * `Buffer.from(array)` and `Buffer.from(string)` may also use the internal`Buffer` pool like `Buffer.allocUnsafe()` does.
           */
          from(arrayBuffer: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>, byteOffset?: number, length?: number): Buffer;
          /**
           * Creates a new Buffer using the passed {data}
           * @param data data to create a new Buffer
           */
          from(data: Uint8Array | ReadonlyArray<number>): Buffer;
          from(data: WithImplicitCoercion<Uint8Array | ReadonlyArray<number> | string>): Buffer;
          /**
           * Creates a new Buffer containing the given JavaScript string {str}.
           * If provided, the {encoding} parameter identifies the character encoding.
           * If not provided, {encoding} defaults to 'utf8'.
           */
          from(
              str:
                  | WithImplicitCoercion<string>
                  | {
                        [Symbol.toPrimitive](hint: 'string'): string;
                    },
              encoding?: BufferEncoding
          ): Buffer;
          /**
           * Creates a new Buffer using the passed {data}
           * @param values to create a new Buffer
           */
          of(...items: number[]): Buffer;
          /**
           * Returns `true` if `obj` is a `Buffer`, `false` otherwise.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * Buffer.isBuffer(Buffer.alloc(10)); // true
           * Buffer.isBuffer(Buffer.from('foo')); // true
           * Buffer.isBuffer('a string'); // false
           * Buffer.isBuffer([]); // false
           * Buffer.isBuffer(new Uint8Array(1024)); // false
           * ```
           */
          isBuffer(obj: any): obj is Buffer;
          /**
           * Returns `true` if `encoding` is the name of a supported character encoding,
           * or `false` otherwise.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * console.log(Buffer.isEncoding('utf8'));
           * // Prints: true
           *
           * console.log(Buffer.isEncoding('hex'));
           * // Prints: true
           *
           * console.log(Buffer.isEncoding('utf/8'));
           * // Prints: false
           *
           * console.log(Buffer.isEncoding(''));
           * // Prints: false
           * ```
           * @param encoding A character encoding name to check.
           */
          isEncoding(encoding: string): encoding is BufferEncoding;
          /**
           * Returns the byte length of a string when encoded using `encoding`.
           * This is not the same as [`String.prototype.length`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length), which does not account
           * for the encoding that is used to convert the string into bytes.
           *
           * For `'base64'`, `'base64url'`, and `'hex'`, this function assumes valid input.
           * For strings that contain non-base64/hex-encoded data (e.g. whitespace), the
           * return value might be greater than the length of a `Buffer` created from the
           * string.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const str = '\u00bd + \u00bc = \u00be';
           *
           * console.log(`${str}: ${str.length} characters, ` +
           *             `${Buffer.byteLength(str, 'utf8')} bytes`);
           * // Prints: ½ + ¼ = ¾: 9 characters, 12 bytes
           * ```
           *
           * When `string` is a
           * `Buffer`/[`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView)/[`TypedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/-
           * Reference/Global_Objects/TypedArray)/[`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer)/[`SharedArrayBuffer`](https://develop-
           * er.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer), the byte length as reported by `.byteLength`is returned.
           * @param string A value to calculate the length of.
           * @param [encoding='utf8'] If `string` is a string, this is its encoding.
           * @return The number of bytes contained within `string`.
           */
          byteLength(string: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, encoding?: BufferEncoding): number;
          /**
           * Returns a new `Buffer` which is the result of concatenating all the `Buffer`instances in the `list` together.
           *
           * If the list has no items, or if the `totalLength` is 0, then a new zero-length`Buffer` is returned.
           *
           * If `totalLength` is not provided, it is calculated from the `Buffer` instances
           * in `list` by adding their lengths.
           *
           * If `totalLength` is provided, it is coerced to an unsigned integer. If the
           * combined length of the `Buffer`s in `list` exceeds `totalLength`, the result is
           * truncated to `totalLength`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Create a single `Buffer` from a list of three `Buffer` instances.
           *
           * const buf1 = Buffer.alloc(10);
           * const buf2 = Buffer.alloc(14);
           * const buf3 = Buffer.alloc(18);
           * const totalLength = buf1.length + buf2.length + buf3.length;
           *
           * console.log(totalLength);
           * // Prints: 42
           *
           * const bufA = Buffer.concat([buf1, buf2, buf3], totalLength);
           *
           * console.log(bufA);
           * // Prints: <Buffer 00 00 00 00 ...>
           * console.log(bufA.length);
           * // Prints: 42
           * ```
           *
           * `Buffer.concat()` may also use the internal `Buffer` pool like `Buffer.allocUnsafe()` does.
           * @param list List of `Buffer` or {@link Uint8Array} instances to concatenate.
           * @param totalLength Total length of the `Buffer` instances in `list` when concatenated.
           */
          concat(list: ReadonlyArray<Uint8Array>, totalLength?: number): Buffer;
          /**
           * Compares `buf1` to `buf2`, typically for the purpose of sorting arrays of`Buffer` instances. This is equivalent to calling `buf1.compare(buf2)`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from('1234');
           * const buf2 = Buffer.from('0123');
           * const arr = [buf1, buf2];
           *
           * console.log(arr.sort(Buffer.compare));
           * // Prints: [ <Buffer 30 31 32 33>, <Buffer 31 32 33 34> ]
           * // (This result is equal to: [buf2, buf1].)
           * ```
           * @return Either `-1`, `0`, or `1`, depending on the result of the comparison. See `compare` for details.
           */
          compare(buf1: Uint8Array, buf2: Uint8Array): -1 | 0 | 1;
          /**
           * Allocates a new `Buffer` of `size` bytes. If `fill` is `undefined`, the`Buffer` will be zero-filled.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.alloc(5);
           *
           * console.log(buf);
           * // Prints: <Buffer 00 00 00 00 00>
           * ```
           *
           * If `size` is larger than {@link constants.MAX_LENGTH} or smaller than 0, `ERR_INVALID_ARG_VALUE` is thrown.
           *
           * If `fill` is specified, the allocated `Buffer` will be initialized by calling `buf.fill(fill)`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.alloc(5, 'a');
           *
           * console.log(buf);
           * // Prints: <Buffer 61 61 61 61 61>
           * ```
           *
           * If both `fill` and `encoding` are specified, the allocated `Buffer` will be
           * initialized by calling `buf.fill(fill, encoding)`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.alloc(11, 'aGVsbG8gd29ybGQ=', 'base64');
           *
           * console.log(buf);
           * // Prints: <Buffer 68 65 6c 6c 6f 20 77 6f 72 6c 64>
           * ```
           *
           * Calling `Buffer.alloc()` can be measurably slower than the alternative `Buffer.allocUnsafe()` but ensures that the newly created `Buffer` instance
           * contents will never contain sensitive data from previous allocations, including
           * data that might not have been allocated for `Buffer`s.
           *
           * A `TypeError` will be thrown if `size` is not a number.
           * @param size The desired length of the new `Buffer`.
           * @param [fill=0] A value to pre-fill the new `Buffer` with.
           * @param [encoding='utf8'] If `fill` is a string, this is its encoding.
           */
          alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
          /**
           * Allocates a new `Buffer` of `size` bytes. If `size` is larger than {@link constants.MAX_LENGTH} or smaller than 0, `ERR_INVALID_ARG_VALUE` is thrown.
           *
           * The underlying memory for `Buffer` instances created in this way is _not_
           * _initialized_. The contents of the newly created `Buffer` are unknown and _may contain sensitive data_. Use `Buffer.alloc()` instead to initialize`Buffer` instances with zeroes.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(10);
           *
           * console.log(buf);
           * // Prints (contents may vary): <Buffer a0 8b 28 3f 01 00 00 00 50 32>
           *
           * buf.fill(0);
           *
           * console.log(buf);
           * // Prints: <Buffer 00 00 00 00 00 00 00 00 00 00>
           * ```
           *
           * A `TypeError` will be thrown if `size` is not a number.
           *
           * The `Buffer` module pre-allocates an internal `Buffer` instance of
           * size `Buffer.poolSize` that is used as a pool for the fast allocation of new`Buffer` instances created using `Buffer.allocUnsafe()`,`Buffer.from(array)`, `Buffer.concat()`, and the
           * deprecated`new Buffer(size)` constructor only when `size` is less than or equal
           * to `Buffer.poolSize >> 1` (floor of `Buffer.poolSize` divided by two).
           *
           * Use of this pre-allocated internal memory pool is a key difference between
           * calling `Buffer.alloc(size, fill)` vs. `Buffer.allocUnsafe(size).fill(fill)`.
           * Specifically, `Buffer.alloc(size, fill)` will _never_ use the internal `Buffer`pool, while `Buffer.allocUnsafe(size).fill(fill)`_will_ use the internal`Buffer` pool if `size` is less
           * than or equal to half `Buffer.poolSize`. The
           * difference is subtle but can be important when an application requires the
           * additional performance that `Buffer.allocUnsafe()` provides.
           * @param size The desired length of the new `Buffer`.
           */
          allocUnsafe(size: number): Buffer;
          /**
           * Allocates a new `Buffer` of `size` bytes. If `size` is larger than {@link constants.MAX_LENGTH} or smaller than 0, `ERR_INVALID_ARG_VALUE` is thrown. A zero-length `Buffer` is created
           * if `size` is 0.
           *
           * The underlying memory for `Buffer` instances created in this way is _not_
           * _initialized_. The contents of the newly created `Buffer` are unknown and_may contain sensitive data_. Use `buf.fill(0)` to initialize
           * such `Buffer` instances with zeroes.
           *
           * When using `Buffer.allocUnsafe()` to allocate new `Buffer` instances,
           * allocations under 4 KB are sliced from a single pre-allocated `Buffer`. This
           * allows applications to avoid the garbage collection overhead of creating many
           * individually allocated `Buffer` instances. This approach improves both
           * performance and memory usage by eliminating the need to track and clean up as
           * many individual `ArrayBuffer` objects.
           *
           * However, in the case where a developer may need to retain a small chunk of
           * memory from a pool for an indeterminate amount of time, it may be appropriate
           * to create an un-pooled `Buffer` instance using `Buffer.allocUnsafeSlow()` and
           * then copying out the relevant bits.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Need to keep around a few small chunks of memory.
           * const store = [];
           *
           * socket.on('readable', () => {
           *   let data;
           *   while (null !== (data = readable.read())) {
           *     // Allocate for retained data.
           *     const sb = Buffer.allocUnsafeSlow(10);
           *
           *     // Copy the data into the new allocation.
           *     data.copy(sb, 0, 0, 10);
           *
           *     store.push(sb);
           *   }
           * });
           * ```
           *
           * A `TypeError` will be thrown if `size` is not a number.
           * @param size The desired length of the new `Buffer`.
           */
          allocUnsafeSlow(size: number): Buffer;
          /**
           * This is the size (in bytes) of pre-allocated internal `Buffer` instances used
           * for pooling. This value may be modified.
           */
          poolSize: number;
      }
      interface Buffer extends Uint8Array {
          /**
           * Writes `string` to `buf` at `offset` according to the character encoding in`encoding`. The `length` parameter is the number of bytes to write. If `buf` did
           * not contain enough space to fit the entire string, only part of `string` will be
           * written. However, partially encoded characters will not be written.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.alloc(256);
           *
           * const len = buf.write('\u00bd + \u00bc = \u00be', 0);
           *
           * console.log(`${len} bytes: ${buf.toString('utf8', 0, len)}`);
           * // Prints: 12 bytes: ½ + ¼ = ¾
           *
           * const buffer = Buffer.alloc(10);
           *
           * const length = buffer.write('abcd', 8);
           *
           * console.log(`${length} bytes: ${buffer.toString('utf8', 8, 10)}`);
           * // Prints: 2 bytes : ab
           * ```
           * @param string String to write to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write `string`.
           * @param [length=buf.length - offset] Maximum number of bytes to write (written bytes will not exceed `buf.length - offset`).
           * @param [encoding='utf8'] The character encoding of `string`.
           * @return Number of bytes written.
           */
          write(string: string, encoding?: BufferEncoding): number;
          write(string: string, offset: number, encoding?: BufferEncoding): number;
          write(string: string, offset: number, length: number, encoding?: BufferEncoding): number;
          /**
           * Decodes `buf` to a string according to the specified character encoding in`encoding`. `start` and `end` may be passed to decode only a subset of `buf`.
           *
           * If `encoding` is `'utf8'` and a byte sequence in the input is not valid UTF-8,
           * then each invalid byte is replaced with the replacement character `U+FFFD`.
           *
           * The maximum length of a string instance (in UTF-16 code units) is available
           * as {@link constants.MAX_STRING_LENGTH}.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.allocUnsafe(26);
           *
           * for (let i = 0; i < 26; i++) {
           *   // 97 is the decimal ASCII value for 'a'.
           *   buf1[i] = i + 97;
           * }
           *
           * console.log(buf1.toString('utf8'));
           * // Prints: abcdefghijklmnopqrstuvwxyz
           * console.log(buf1.toString('utf8', 0, 5));
           * // Prints: abcde
           *
           * const buf2 = Buffer.from('tést');
           *
           * console.log(buf2.toString('hex'));
           * // Prints: 74c3a97374
           * console.log(buf2.toString('utf8', 0, 3));
           * // Prints: té
           * console.log(buf2.toString(undefined, 0, 3));
           * // Prints: té
           * ```
           * @param [encoding='utf8'] The character encoding to use.
           * @param [start=0] The byte offset to start decoding at.
           * @param [end=buf.length] The byte offset to stop decoding at (not inclusive).
           */
          toString(encoding?: BufferEncoding, start?: number, end?: number): string;
          /**
           * Returns a JSON representation of `buf`. [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify) implicitly calls
           * this function when stringifying a `Buffer` instance.
           *
           * `Buffer.from()` accepts objects in the format returned from this method.
           * In particular, `Buffer.from(buf.toJSON())` works like `Buffer.from(buf)`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5]);
           * const json = JSON.stringify(buf);
           *
           * console.log(json);
           * // Prints: {"type":"Buffer","data":[1,2,3,4,5]}
           *
           * const copy = JSON.parse(json, (key, value) => {
           *   return value &#x26;&#x26; value.type === 'Buffer' ?
           *     Buffer.from(value) :
           *     value;
           * });
           *
           * console.log(copy);
           * // Prints: <Buffer 01 02 03 04 05>
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           */
          toJSON(): {
              type: 'Buffer';
              data: number[];
          };
          /**
           * Returns `true` if both `buf` and `otherBuffer` have exactly the same bytes,`false` otherwise. Equivalent to `buf.compare(otherBuffer) === 0`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from('ABC');
           * const buf2 = Buffer.from('414243', 'hex');
           * const buf3 = Buffer.from('ABCD');
           *
           * console.log(buf1.equals(buf2));
           * // Prints: true
           * console.log(buf1.equals(buf3));
           * // Prints: false
           * ```
           * @param otherBuffer A `Buffer` or {@link Uint8Array} with which to compare `buf`.
           */
          equals(otherBuffer: Uint8Array): boolean;
          /**
           * Compares `buf` with `target` and returns a number indicating whether `buf`comes before, after, or is the same as `target` in sort order.
           * Comparison is based on the actual sequence of bytes in each `Buffer`.
           *
           * * `0` is returned if `target` is the same as `buf`
           * * `1` is returned if `target` should come _before_`buf` when sorted.
           * * `-1` is returned if `target` should come _after_`buf` when sorted.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from('ABC');
           * const buf2 = Buffer.from('BCD');
           * const buf3 = Buffer.from('ABCD');
           *
           * console.log(buf1.compare(buf1));
           * // Prints: 0
           * console.log(buf1.compare(buf2));
           * // Prints: -1
           * console.log(buf1.compare(buf3));
           * // Prints: -1
           * console.log(buf2.compare(buf1));
           * // Prints: 1
           * console.log(buf2.compare(buf3));
           * // Prints: 1
           * console.log([buf1, buf2, buf3].sort(Buffer.compare));
           * // Prints: [ <Buffer 41 42 43>, <Buffer 41 42 43 44>, <Buffer 42 43 44> ]
           * // (This result is equal to: [buf1, buf3, buf2].)
           * ```
           *
           * The optional `targetStart`, `targetEnd`, `sourceStart`, and `sourceEnd`arguments can be used to limit the comparison to specific ranges within `target`and `buf` respectively.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
           * const buf2 = Buffer.from([5, 6, 7, 8, 9, 1, 2, 3, 4]);
           *
           * console.log(buf1.compare(buf2, 5, 9, 0, 4));
           * // Prints: 0
           * console.log(buf1.compare(buf2, 0, 6, 4));
           * // Prints: -1
           * console.log(buf1.compare(buf2, 5, 6, 5));
           * // Prints: 1
           * ```
           *
           * `ERR_OUT_OF_RANGE` is thrown if `targetStart < 0`, `sourceStart < 0`,`targetEnd > target.byteLength`, or `sourceEnd > source.byteLength`.
           * @param target A `Buffer` or {@link Uint8Array} with which to compare `buf`.
           * @param [targetStart=0] The offset within `target` at which to begin comparison.
           * @param [targetEnd=target.length] The offset within `target` at which to end comparison (not inclusive).
           * @param [sourceStart=0] The offset within `buf` at which to begin comparison.
           * @param [sourceEnd=buf.length] The offset within `buf` at which to end comparison (not inclusive).
           */
          compare(target: Uint8Array, targetStart?: number, targetEnd?: number, sourceStart?: number, sourceEnd?: number): -1 | 0 | 1;
          /**
           * Copies data from a region of `buf` to a region in `target`, even if the `target`memory region overlaps with `buf`.
           *
           * [`TypedArray.prototype.set()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/set) performs the same operation, and is available
           * for all TypedArrays, including Node.js `Buffer`s, although it takes
           * different function arguments.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Create two `Buffer` instances.
           * const buf1 = Buffer.allocUnsafe(26);
           * const buf2 = Buffer.allocUnsafe(26).fill('!');
           *
           * for (let i = 0; i < 26; i++) {
           *   // 97 is the decimal ASCII value for 'a'.
           *   buf1[i] = i + 97;
           * }
           *
           * // Copy `buf1` bytes 16 through 19 into `buf2` starting at byte 8 of `buf2`.
           * buf1.copy(buf2, 8, 16, 20);
           * // This is equivalent to:
           * // buf2.set(buf1.subarray(16, 20), 8);
           *
           * console.log(buf2.toString('ascii', 0, 25));
           * // Prints: !!!!!!!!qrst!!!!!!!!!!!!!
           * ```
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Create a `Buffer` and copy data from one region to an overlapping region
           * // within the same `Buffer`.
           *
           * const buf = Buffer.allocUnsafe(26);
           *
           * for (let i = 0; i < 26; i++) {
           *   // 97 is the decimal ASCII value for 'a'.
           *   buf[i] = i + 97;
           * }
           *
           * buf.copy(buf, 0, 4, 10);
           *
           * console.log(buf.toString());
           * // Prints: efghijghijklmnopqrstuvwxyz
           * ```
           * @param target A `Buffer` or {@link Uint8Array} to copy into.
           * @param [targetStart=0] The offset within `target` at which to begin writing.
           * @param [sourceStart=0] The offset within `buf` from which to begin copying.
           * @param [sourceEnd=buf.length] The offset within `buf` at which to stop copying (not inclusive).
           * @return The number of bytes copied.
           */
          copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
          /**
           * Returns a new `Buffer` that references the same memory as the original, but
           * offset and cropped by the `start` and `end` indices.
           *
           * This method is not compatible with the `Uint8Array.prototype.slice()`,
           * which is a superclass of `Buffer`. To copy the slice, use`Uint8Array.prototype.slice()`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('buffer');
           *
           * const copiedBuf = Uint8Array.prototype.slice.call(buf);
           * copiedBuf[0]++;
           * console.log(copiedBuf.toString());
           * // Prints: cuffer
           *
           * console.log(buf.toString());
           * // Prints: buffer
           *
           * // With buf.slice(), the original buffer is modified.
           * const notReallyCopiedBuf = buf.slice();
           * notReallyCopiedBuf[0]++;
           * console.log(notReallyCopiedBuf.toString());
           * // Prints: cuffer
           * console.log(buf.toString());
           * // Also prints: cuffer (!)
           * ```
           * @deprecated Use `subarray` instead.
           * @param [start=0] Where the new `Buffer` will start.
           * @param [end=buf.length] Where the new `Buffer` will end (not inclusive).
           */
          slice(start?: number, end?: number): Buffer;
          /**
           * Returns a new `Buffer` that references the same memory as the original, but
           * offset and cropped by the `start` and `end` indices.
           *
           * Specifying `end` greater than `buf.length` will return the same result as
           * that of `end` equal to `buf.length`.
           *
           * This method is inherited from [`TypedArray.prototype.subarray()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray).
           *
           * Modifying the new `Buffer` slice will modify the memory in the original `Buffer`because the allocated memory of the two objects overlap.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Create a `Buffer` with the ASCII alphabet, take a slice, and modify one byte
           * // from the original `Buffer`.
           *
           * const buf1 = Buffer.allocUnsafe(26);
           *
           * for (let i = 0; i < 26; i++) {
           *   // 97 is the decimal ASCII value for 'a'.
           *   buf1[i] = i + 97;
           * }
           *
           * const buf2 = buf1.subarray(0, 3);
           *
           * console.log(buf2.toString('ascii', 0, buf2.length));
           * // Prints: abc
           *
           * buf1[0] = 33;
           *
           * console.log(buf2.toString('ascii', 0, buf2.length));
           * // Prints: !bc
           * ```
           *
           * Specifying negative indexes causes the slice to be generated relative to the
           * end of `buf` rather than the beginning.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('buffer');
           *
           * console.log(buf.subarray(-6, -1).toString());
           * // Prints: buffe
           * // (Equivalent to buf.subarray(0, 5).)
           *
           * console.log(buf.subarray(-6, -2).toString());
           * // Prints: buff
           * // (Equivalent to buf.subarray(0, 4).)
           *
           * console.log(buf.subarray(-5, -2).toString());
           * // Prints: uff
           * // (Equivalent to buf.subarray(1, 4).)
           * ```
           * @param [start=0] Where the new `Buffer` will start.
           * @param [end=buf.length] Where the new `Buffer` will end (not inclusive).
           */
          subarray(start?: number, end?: number): Buffer;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian.
           *
           * `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(8);
           *
           * buf.writeBigInt64BE(0x0102030405060708n, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 01 02 03 04 05 06 07 08>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy: `0 <= offset <= buf.length - 8`.
           * @return `offset` plus the number of bytes written.
           */
          writeBigInt64BE(value: bigint, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian.
           *
           * `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(8);
           *
           * buf.writeBigInt64LE(0x0102030405060708n, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 08 07 06 05 04 03 02 01>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy: `0 <= offset <= buf.length - 8`.
           * @return `offset` plus the number of bytes written.
           */
          writeBigInt64LE(value: bigint, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian.
           *
           * This function is also available under the `writeBigUint64BE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(8);
           *
           * buf.writeBigUInt64BE(0xdecafafecacefaden, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer de ca fa fe ca ce fa de>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy: `0 <= offset <= buf.length - 8`.
           * @return `offset` plus the number of bytes written.
           */
          writeBigUInt64BE(value: bigint, offset?: number): number;
          /**
           * @alias Buffer.writeBigUInt64BE
           */
          writeBigUint64BE(value: bigint, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(8);
           *
           * buf.writeBigUInt64LE(0xdecafafecacefaden, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer de fa ce ca fe fa ca de>
           * ```
           *
           * This function is also available under the `writeBigUint64LE` alias.
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy: `0 <= offset <= buf.length - 8`.
           * @return `offset` plus the number of bytes written.
           */
          writeBigUInt64LE(value: bigint, offset?: number): number;
          /**
           * @alias Buffer.writeBigUInt64LE
           */
          writeBigUint64LE(value: bigint, offset?: number): number;
          /**
           * Writes `byteLength` bytes of `value` to `buf` at the specified `offset`as little-endian. Supports up to 48 bits of accuracy. Behavior is undefined
           * when `value` is anything other than an unsigned integer.
           *
           * This function is also available under the `writeUintLE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(6);
           *
           * buf.writeUIntLE(0x1234567890ab, 0, 6);
           *
           * console.log(buf);
           * // Prints: <Buffer ab 90 78 56 34 12>
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param value Number to be written to `buf`.
           * @param offset Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to write. Must satisfy `0 < byteLength <= 6`.
           * @return `offset` plus the number of bytes written.
           */
          writeUIntLE(value: number, offset: number, byteLength: number): number;
          /**
           * @alias Buffer.writeUIntLE
           */
          writeUintLE(value: number, offset: number, byteLength: number): number;
          /**
           * Writes `byteLength` bytes of `value` to `buf` at the specified `offset`as big-endian. Supports up to 48 bits of accuracy. Behavior is undefined
           * when `value` is anything other than an unsigned integer.
           *
           * This function is also available under the `writeUintBE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(6);
           *
           * buf.writeUIntBE(0x1234567890ab, 0, 6);
           *
           * console.log(buf);
           * // Prints: <Buffer 12 34 56 78 90 ab>
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param value Number to be written to `buf`.
           * @param offset Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to write. Must satisfy `0 < byteLength <= 6`.
           * @return `offset` plus the number of bytes written.
           */
          writeUIntBE(value: number, offset: number, byteLength: number): number;
          /**
           * @alias Buffer.writeUIntBE
           */
          writeUintBE(value: number, offset: number, byteLength: number): number;
          /**
           * Writes `byteLength` bytes of `value` to `buf` at the specified `offset`as little-endian. Supports up to 48 bits of accuracy. Behavior is undefined
           * when `value` is anything other than a signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(6);
           *
           * buf.writeIntLE(0x1234567890ab, 0, 6);
           *
           * console.log(buf);
           * // Prints: <Buffer ab 90 78 56 34 12>
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param value Number to be written to `buf`.
           * @param offset Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to write. Must satisfy `0 < byteLength <= 6`.
           * @return `offset` plus the number of bytes written.
           */
          writeIntLE(value: number, offset: number, byteLength: number): number;
          /**
           * Writes `byteLength` bytes of `value` to `buf` at the specified `offset`as big-endian. Supports up to 48 bits of accuracy. Behavior is undefined when`value` is anything other than a
           * signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(6);
           *
           * buf.writeIntBE(0x1234567890ab, 0, 6);
           *
           * console.log(buf);
           * // Prints: <Buffer 12 34 56 78 90 ab>
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param value Number to be written to `buf`.
           * @param offset Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to write. Must satisfy `0 < byteLength <= 6`.
           * @return `offset` plus the number of bytes written.
           */
          writeIntBE(value: number, offset: number, byteLength: number): number;
          /**
           * Reads an unsigned, big-endian 64-bit integer from `buf` at the specified`offset`.
           *
           * This function is also available under the `readBigUint64BE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]);
           *
           * console.log(buf.readBigUInt64BE(0));
           * // Prints: 4294967295n
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy: `0 <= offset <= buf.length - 8`.
           */
          readBigUInt64BE(offset?: number): bigint;
          /**
           * @alias Buffer.readBigUInt64BE
           */
          readBigUint64BE(offset?: number): bigint;
          /**
           * Reads an unsigned, little-endian 64-bit integer from `buf` at the specified`offset`.
           *
           * This function is also available under the `readBigUint64LE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]);
           *
           * console.log(buf.readBigUInt64LE(0));
           * // Prints: 18446744069414584320n
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy: `0 <= offset <= buf.length - 8`.
           */
          readBigUInt64LE(offset?: number): bigint;
          /**
           * @alias Buffer.readBigUInt64LE
           */
          readBigUint64LE(offset?: number): bigint;
          /**
           * Reads a signed, big-endian 64-bit integer from `buf` at the specified `offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed
           * values.
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy: `0 <= offset <= buf.length - 8`.
           */
          readBigInt64BE(offset?: number): bigint;
          /**
           * Reads a signed, little-endian 64-bit integer from `buf` at the specified`offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed
           * values.
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy: `0 <= offset <= buf.length - 8`.
           */
          readBigInt64LE(offset?: number): bigint;
          /**
           * Reads `byteLength` number of bytes from `buf` at the specified `offset`and interprets the result as an unsigned, little-endian integer supporting
           * up to 48 bits of accuracy.
           *
           * This function is also available under the `readUintLE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]);
           *
           * console.log(buf.readUIntLE(0, 6).toString(16));
           * // Prints: ab9078563412
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param offset Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to read. Must satisfy `0 < byteLength <= 6`.
           */
          readUIntLE(offset: number, byteLength: number): number;
          /**
           * @alias Buffer.readUIntLE
           */
          readUintLE(offset: number, byteLength: number): number;
          /**
           * Reads `byteLength` number of bytes from `buf` at the specified `offset`and interprets the result as an unsigned big-endian integer supporting
           * up to 48 bits of accuracy.
           *
           * This function is also available under the `readUintBE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]);
           *
           * console.log(buf.readUIntBE(0, 6).toString(16));
           * // Prints: 1234567890ab
           * console.log(buf.readUIntBE(1, 6).toString(16));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param offset Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to read. Must satisfy `0 < byteLength <= 6`.
           */
          readUIntBE(offset: number, byteLength: number): number;
          /**
           * @alias Buffer.readUIntBE
           */
          readUintBE(offset: number, byteLength: number): number;
          /**
           * Reads `byteLength` number of bytes from `buf` at the specified `offset`and interprets the result as a little-endian, two's complement signed value
           * supporting up to 48 bits of accuracy.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]);
           *
           * console.log(buf.readIntLE(0, 6).toString(16));
           * // Prints: -546f87a9cbee
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param offset Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to read. Must satisfy `0 < byteLength <= 6`.
           */
          readIntLE(offset: number, byteLength: number): number;
          /**
           * Reads `byteLength` number of bytes from `buf` at the specified `offset`and interprets the result as a big-endian, two's complement signed value
           * supporting up to 48 bits of accuracy.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]);
           *
           * console.log(buf.readIntBE(0, 6).toString(16));
           * // Prints: 1234567890ab
           * console.log(buf.readIntBE(1, 6).toString(16));
           * // Throws ERR_OUT_OF_RANGE.
           * console.log(buf.readIntBE(1, 0).toString(16));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           *
           * Note: as of Bun v0.1.2, this is not implemented yet.
           * @param offset Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - byteLength`.
           * @param byteLength Number of bytes to read. Must satisfy `0 < byteLength <= 6`.
           */
          readIntBE(offset: number, byteLength: number): number;
          /**
           * Reads an unsigned 8-bit integer from `buf` at the specified `offset`.
           *
           * This function is also available under the `readUint8` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([1, -2]);
           *
           * console.log(buf.readUInt8(0));
           * // Prints: 1
           * console.log(buf.readUInt8(1));
           * // Prints: 254
           * console.log(buf.readUInt8(2));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 1`.
           */
          readUInt8(offset?: number): number;
          /**
           * @alias Buffer.readUInt8
           */
          readUint8(offset?: number): number;
          /**
           * Reads an unsigned, little-endian 16-bit integer from `buf` at the specified`offset`.
           *
           * This function is also available under the `readUint16LE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56]);
           *
           * console.log(buf.readUInt16LE(0).toString(16));
           * // Prints: 3412
           * console.log(buf.readUInt16LE(1).toString(16));
           * // Prints: 5634
           * console.log(buf.readUInt16LE(2).toString(16));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 2`.
           */
          readUInt16LE(offset?: number): number;
          /**
           * @alias Buffer.readUInt16LE
           */
          readUint16LE(offset?: number): number;
          /**
           * Reads an unsigned, big-endian 16-bit integer from `buf` at the specified`offset`.
           *
           * This function is also available under the `readUint16BE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56]);
           *
           * console.log(buf.readUInt16BE(0).toString(16));
           * // Prints: 1234
           * console.log(buf.readUInt16BE(1).toString(16));
           * // Prints: 3456
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 2`.
           */
          readUInt16BE(offset?: number): number;
          /**
           * @alias Buffer.readUInt16BE
           */
          readUint16BE(offset?: number): number;
          /**
           * Reads an unsigned, little-endian 32-bit integer from `buf` at the specified`offset`.
           *
           * This function is also available under the `readUint32LE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56, 0x78]);
           *
           * console.log(buf.readUInt32LE(0).toString(16));
           * // Prints: 78563412
           * console.log(buf.readUInt32LE(1).toString(16));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 4`.
           */
          readUInt32LE(offset?: number): number;
          /**
           * @alias Buffer.readUInt32LE
           */
          readUint32LE(offset?: number): number;
          /**
           * Reads an unsigned, big-endian 32-bit integer from `buf` at the specified`offset`.
           *
           * This function is also available under the `readUint32BE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0x12, 0x34, 0x56, 0x78]);
           *
           * console.log(buf.readUInt32BE(0).toString(16));
           * // Prints: 12345678
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 4`.
           */
          readUInt32BE(offset?: number): number;
          /**
           * @alias Buffer.readUInt32BE
           */
          readUint32BE(offset?: number): number;
          /**
           * Reads a signed 8-bit integer from `buf` at the specified `offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed values.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([-1, 5]);
           *
           * console.log(buf.readInt8(0));
           * // Prints: -1
           * console.log(buf.readInt8(1));
           * // Prints: 5
           * console.log(buf.readInt8(2));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 1`.
           */
          readInt8(offset?: number): number;
          /**
           * Reads a signed, little-endian 16-bit integer from `buf` at the specified`offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed values.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0, 5]);
           *
           * console.log(buf.readInt16LE(0));
           * // Prints: 1280
           * console.log(buf.readInt16LE(1));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 2`.
           */
          readInt16LE(offset?: number): number;
          /**
           * Reads a signed, big-endian 16-bit integer from `buf` at the specified `offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed values.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0, 5]);
           *
           * console.log(buf.readInt16BE(0));
           * // Prints: 5
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 2`.
           */
          readInt16BE(offset?: number): number;
          /**
           * Reads a signed, little-endian 32-bit integer from `buf` at the specified`offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed values.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0, 0, 0, 5]);
           *
           * console.log(buf.readInt32LE(0));
           * // Prints: 83886080
           * console.log(buf.readInt32LE(1));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 4`.
           */
          readInt32LE(offset?: number): number;
          /**
           * Reads a signed, big-endian 32-bit integer from `buf` at the specified `offset`.
           *
           * Integers read from a `Buffer` are interpreted as two's complement signed values.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([0, 0, 0, 5]);
           *
           * console.log(buf.readInt32BE(0));
           * // Prints: 5
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 4`.
           */
          readInt32BE(offset?: number): number;
          /**
           * Reads a 32-bit, little-endian float from `buf` at the specified `offset`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([1, 2, 3, 4]);
           *
           * console.log(buf.readFloatLE(0));
           * // Prints: 1.539989614439558e-36
           * console.log(buf.readFloatLE(1));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 4`.
           */
          readFloatLE(offset?: number): number;
          /**
           * Reads a 32-bit, big-endian float from `buf` at the specified `offset`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([1, 2, 3, 4]);
           *
           * console.log(buf.readFloatBE(0));
           * // Prints: 2.387939260590663e-38
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 4`.
           */
          readFloatBE(offset?: number): number;
          /**
           * Reads a 64-bit, little-endian double from `buf` at the specified `offset`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
           *
           * console.log(buf.readDoubleLE(0));
           * // Prints: 5.447603722011605e-270
           * console.log(buf.readDoubleLE(1));
           * // Throws ERR_OUT_OF_RANGE.
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 8`.
           */
          readDoubleLE(offset?: number): number;
          /**
           * Reads a 64-bit, big-endian double from `buf` at the specified `offset`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
           *
           * console.log(buf.readDoubleBE(0));
           * // Prints: 8.20788039913184e-304
           * ```
           * @param [offset=0] Number of bytes to skip before starting to read. Must satisfy `0 <= offset <= buf.length - 8`.
           */
          readDoubleBE(offset?: number): number;
          reverse(): this;
          /**
           * Interprets `buf` as an array of unsigned 16-bit integers and swaps the
           * byte order _in-place_. Throws `ERR_INVALID_BUFFER_SIZE` if `buf.length` is not a multiple of 2.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8]);
           *
           * console.log(buf1);
           * // Prints: <Buffer 01 02 03 04 05 06 07 08>
           *
           * buf1.swap16();
           *
           * console.log(buf1);
           * // Prints: <Buffer 02 01 04 03 06 05 08 07>
           *
           * const buf2 = Buffer.from([0x1, 0x2, 0x3]);
           *
           * buf2.swap16();
           * // Throws ERR_INVALID_BUFFER_SIZE.
           * ```
           *
           * One convenient use of `buf.swap16()` is to perform a fast in-place conversion
           * between UTF-16 little-endian and UTF-16 big-endian:
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('This is little-endian UTF-16', 'utf16le');
           * buf.swap16(); // Convert to big-endian UTF-16 text.
           * ```
           * @return A reference to `buf`.
           */
          swap16(): Buffer;
          /**
           * Interprets `buf` as an array of unsigned 32-bit integers and swaps the
           * byte order _in-place_. Throws `ERR_INVALID_BUFFER_SIZE` if `buf.length` is not a multiple of 4.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8]);
           *
           * console.log(buf1);
           * // Prints: <Buffer 01 02 03 04 05 06 07 08>
           *
           * buf1.swap32();
           *
           * console.log(buf1);
           * // Prints: <Buffer 04 03 02 01 08 07 06 05>
           *
           * const buf2 = Buffer.from([0x1, 0x2, 0x3]);
           *
           * buf2.swap32();
           * // Throws ERR_INVALID_BUFFER_SIZE.
           * ```
           * @return A reference to `buf`.
           */
          swap32(): Buffer;
          /**
           * Interprets `buf` as an array of 64-bit numbers and swaps byte order _in-place_.
           * Throws `ERR_INVALID_BUFFER_SIZE` if `buf.length` is not a multiple of 8.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf1 = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8]);
           *
           * console.log(buf1);
           * // Prints: <Buffer 01 02 03 04 05 06 07 08>
           *
           * buf1.swap64();
           *
           * console.log(buf1);
           * // Prints: <Buffer 08 07 06 05 04 03 02 01>
           *
           * const buf2 = Buffer.from([0x1, 0x2, 0x3]);
           *
           * buf2.swap64();
           * // Throws ERR_INVALID_BUFFER_SIZE.
           * ```
           * @return A reference to `buf`.
           */
          swap64(): Buffer;
          /**
           * Writes `value` to `buf` at the specified `offset`. `value` must be a
           * valid unsigned 8-bit integer. Behavior is undefined when `value` is anything
           * other than an unsigned 8-bit integer.
           *
           * This function is also available under the `writeUint8` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeUInt8(0x3, 0);
           * buf.writeUInt8(0x4, 1);
           * buf.writeUInt8(0x23, 2);
           * buf.writeUInt8(0x42, 3);
           *
           * console.log(buf);
           * // Prints: <Buffer 03 04 23 42>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 1`.
           * @return `offset` plus the number of bytes written.
           */
          writeUInt8(value: number, offset?: number): number;
          /**
           * @alias Buffer.writeUInt8
           */
          writeUint8(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian. The `value`must be a valid unsigned 16-bit integer. Behavior is undefined when `value` is
           * anything other than an unsigned 16-bit integer.
           *
           * This function is also available under the `writeUint16LE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeUInt16LE(0xdead, 0);
           * buf.writeUInt16LE(0xbeef, 2);
           *
           * console.log(buf);
           * // Prints: <Buffer ad de ef be>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 2`.
           * @return `offset` plus the number of bytes written.
           */
          writeUInt16LE(value: number, offset?: number): number;
          /**
           * @alias Buffer.writeUInt16LE
           */
          writeUint16LE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian. The `value`must be a valid unsigned 16-bit integer. Behavior is undefined when `value`is anything other than an
           * unsigned 16-bit integer.
           *
           * This function is also available under the `writeUint16BE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeUInt16BE(0xdead, 0);
           * buf.writeUInt16BE(0xbeef, 2);
           *
           * console.log(buf);
           * // Prints: <Buffer de ad be ef>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 2`.
           * @return `offset` plus the number of bytes written.
           */
          writeUInt16BE(value: number, offset?: number): number;
          /**
           * @alias Buffer.writeUInt16BE
           */
          writeUint16BE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian. The `value`must be a valid unsigned 32-bit integer. Behavior is undefined when `value` is
           * anything other than an unsigned 32-bit integer.
           *
           * This function is also available under the `writeUint32LE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeUInt32LE(0xfeedface, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer ce fa ed fe>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 4`.
           * @return `offset` plus the number of bytes written.
           */
          writeUInt32LE(value: number, offset?: number): number;
          /**
           * @alias Buffer.writeUInt32LE
           */
          writeUint32LE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian. The `value`must be a valid unsigned 32-bit integer. Behavior is undefined when `value`is anything other than an
           * unsigned 32-bit integer.
           *
           * This function is also available under the `writeUint32BE` alias.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeUInt32BE(0xfeedface, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer fe ed fa ce>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 4`.
           * @return `offset` plus the number of bytes written.
           */
          writeUInt32BE(value: number, offset?: number): number;
          /**
           * @alias Buffer.writeUInt32BE
           */
          writeUint32BE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset`. `value` must be a valid
           * signed 8-bit integer. Behavior is undefined when `value` is anything other than
           * a signed 8-bit integer.
           *
           * `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(2);
           *
           * buf.writeInt8(2, 0);
           * buf.writeInt8(-2, 1);
           *
           * console.log(buf);
           * // Prints: <Buffer 02 fe>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 1`.
           * @return `offset` plus the number of bytes written.
           */
          writeInt8(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian.  The `value`must be a valid signed 16-bit integer. Behavior is undefined when `value` is
           * anything other than a signed 16-bit integer.
           *
           * The `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(2);
           *
           * buf.writeInt16LE(0x0304, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 04 03>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 2`.
           * @return `offset` plus the number of bytes written.
           */
          writeInt16LE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian.  The `value`must be a valid signed 16-bit integer. Behavior is undefined when `value` is
           * anything other than a signed 16-bit integer.
           *
           * The `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(2);
           *
           * buf.writeInt16BE(0x0102, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 01 02>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 2`.
           * @return `offset` plus the number of bytes written.
           */
          writeInt16BE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian. The `value`must be a valid signed 32-bit integer. Behavior is undefined when `value` is
           * anything other than a signed 32-bit integer.
           *
           * The `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeInt32LE(0x05060708, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 08 07 06 05>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 4`.
           * @return `offset` plus the number of bytes written.
           */
          writeInt32LE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian. The `value`must be a valid signed 32-bit integer. Behavior is undefined when `value` is
           * anything other than a signed 32-bit integer.
           *
           * The `value` is interpreted and written as a two's complement signed integer.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeInt32BE(0x01020304, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 01 02 03 04>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 4`.
           * @return `offset` plus the number of bytes written.
           */
          writeInt32BE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian. Behavior is
           * undefined when `value` is anything other than a JavaScript number.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeFloatLE(0xcafebabe, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer bb fe 4a 4f>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 4`.
           * @return `offset` plus the number of bytes written.
           */
          writeFloatLE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian. Behavior is
           * undefined when `value` is anything other than a JavaScript number.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(4);
           *
           * buf.writeFloatBE(0xcafebabe, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 4f 4a fe bb>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 4`.
           * @return `offset` plus the number of bytes written.
           */
          writeFloatBE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as little-endian. The `value`must be a JavaScript number. Behavior is undefined when `value` is anything
           * other than a JavaScript number.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(8);
           *
           * buf.writeDoubleLE(123.456, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 77 be 9f 1a 2f dd 5e 40>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 8`.
           * @return `offset` plus the number of bytes written.
           */
          writeDoubleLE(value: number, offset?: number): number;
          /**
           * Writes `value` to `buf` at the specified `offset` as big-endian. The `value`must be a JavaScript number. Behavior is undefined when `value` is anything
           * other than a JavaScript number.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(8);
           *
           * buf.writeDoubleBE(123.456, 0);
           *
           * console.log(buf);
           * // Prints: <Buffer 40 5e dd 2f 1a 9f be 77>
           * ```
           * @param value Number to be written to `buf`.
           * @param [offset=0] Number of bytes to skip before starting to write. Must satisfy `0 <= offset <= buf.length - 8`.
           * @return `offset` plus the number of bytes written.
           */
          writeDoubleBE(value: number, offset?: number): number;
          /**
           * Fills `buf` with the specified `value`. If the `offset` and `end` are not given,
           * the entire `buf` will be filled:
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Fill a `Buffer` with the ASCII character 'h'.
           *
           * const b = Buffer.allocUnsafe(50).fill('h');
           *
           * console.log(b.toString());
           * // Prints: hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh
           * ```
           *
           * `value` is coerced to a `uint32` value if it is not a string, `Buffer`, or
           * integer. If the resulting integer is greater than `255` (decimal), `buf` will be
           * filled with `value &#x26; 255`.
           *
           * If the final write of a `fill()` operation falls on a multi-byte character,
           * then only the bytes of that character that fit into `buf` are written:
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Fill a `Buffer` with character that takes up two bytes in UTF-8.
           *
           * console.log(Buffer.allocUnsafe(5).fill('\u0222'));
           * // Prints: <Buffer c8 a2 c8 a2 c8>
           * ```
           *
           * If `value` contains invalid characters, it is truncated; if no valid
           * fill data remains, an exception is thrown:
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.allocUnsafe(5);
           *
           * console.log(buf.fill('a'));
           * // Prints: <Buffer 61 61 61 61 61>
           * console.log(buf.fill('aazz', 'hex'));
           * // Prints: <Buffer aa aa aa aa aa>
           * console.log(buf.fill('zz', 'hex'));
           * // Throws an exception.
           * ```
           * @param value The value with which to fill `buf`.
           * @param [offset=0] Number of bytes to skip before starting to fill `buf`.
           * @param [end=buf.length] Where to stop filling `buf` (not inclusive).
           * @param [encoding='utf8'] The encoding for `value` if `value` is a string.
           * @return A reference to `buf`.
           */
          fill(value: string | Uint8Array | number, offset?: number, end?: number, encoding?: BufferEncoding): this;
          /**
           * If `value` is:
           *
           * * a string, `value` is interpreted according to the character encoding in`encoding`.
           * * a `Buffer` or [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), `value` will be used in its entirety.
           * To compare a partial `Buffer`, use `buf.subarray`.
           * * a number, `value` will be interpreted as an unsigned 8-bit integer
           * value between `0` and `255`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('this is a buffer');
           *
           * console.log(buf.indexOf('this'));
           * // Prints: 0
           * console.log(buf.indexOf('is'));
           * // Prints: 2
           * console.log(buf.indexOf(Buffer.from('a buffer')));
           * // Prints: 8
           * console.log(buf.indexOf(97));
           * // Prints: 8 (97 is the decimal ASCII value for 'a')
           * console.log(buf.indexOf(Buffer.from('a buffer example')));
           * // Prints: -1
           * console.log(buf.indexOf(Buffer.from('a buffer example').slice(0, 8)));
           * // Prints: 8
           *
           * const utf16Buffer = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'utf16le');
           *
           * console.log(utf16Buffer.indexOf('\u03a3', 0, 'utf16le'));
           * // Prints: 4
           * console.log(utf16Buffer.indexOf('\u03a3', -4, 'utf16le'));
           * // Prints: 6
           * ```
           *
           * If `value` is not a string, number, or `Buffer`, this method will throw a`TypeError`. If `value` is a number, it will be coerced to a valid byte value,
           * an integer between 0 and 255.
           *
           * If `byteOffset` is not a number, it will be coerced to a number. If the result
           * of coercion is `NaN` or `0`, then the entire buffer will be searched. This
           * behavior matches [`String.prototype.indexOf()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/indexOf).
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const b = Buffer.from('abcdef');
           *
           * // Passing a value that's a number, but not a valid byte.
           * // Prints: 2, equivalent to searching for 99 or 'c'.
           * console.log(b.indexOf(99.9));
           * console.log(b.indexOf(256 + 99));
           *
           * // Passing a byteOffset that coerces to NaN or 0.
           * // Prints: 1, searching the whole buffer.
           * console.log(b.indexOf('b', undefined));
           * console.log(b.indexOf('b', {}));
           * console.log(b.indexOf('b', null));
           * console.log(b.indexOf('b', []));
           * ```
           *
           * If `value` is an empty string or empty `Buffer` and `byteOffset` is less
           * than `buf.length`, `byteOffset` will be returned. If `value` is empty and`byteOffset` is at least `buf.length`, `buf.length` will be returned.
           * @param value What to search for.
           * @param [byteOffset=0] Where to begin searching in `buf`. If negative, then offset is calculated from the end of `buf`.
           * @param [encoding='utf8'] If `value` is a string, this is the encoding used to determine the binary representation of the string that will be searched for in `buf`.
           * @return The index of the first occurrence of `value` in `buf`, or `-1` if `buf` does not contain `value`.
           */
          indexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): number;
          /**
           * Identical to `buf.indexOf()`, except the last occurrence of `value` is found
           * rather than the first occurrence.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('this buffer is a buffer');
           *
           * console.log(buf.lastIndexOf('this'));
           * // Prints: 0
           * console.log(buf.lastIndexOf('buffer'));
           * // Prints: 17
           * console.log(buf.lastIndexOf(Buffer.from('buffer')));
           * // Prints: 17
           * console.log(buf.lastIndexOf(97));
           * // Prints: 15 (97 is the decimal ASCII value for 'a')
           * console.log(buf.lastIndexOf(Buffer.from('yolo')));
           * // Prints: -1
           * console.log(buf.lastIndexOf('buffer', 5));
           * // Prints: 5
           * console.log(buf.lastIndexOf('buffer', 4));
           * // Prints: -1
           *
           * const utf16Buffer = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'utf16le');
           *
           * console.log(utf16Buffer.lastIndexOf('\u03a3', undefined, 'utf16le'));
           * // Prints: 6
           * console.log(utf16Buffer.lastIndexOf('\u03a3', -5, 'utf16le'));
           * // Prints: 4
           * ```
           *
           * If `value` is not a string, number, or `Buffer`, this method will throw a`TypeError`. If `value` is a number, it will be coerced to a valid byte value,
           * an integer between 0 and 255.
           *
           * If `byteOffset` is not a number, it will be coerced to a number. Any arguments
           * that coerce to `NaN`, like `{}` or `undefined`, will search the whole buffer.
           * This behavior matches [`String.prototype.lastIndexOf()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/lastIndexOf).
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const b = Buffer.from('abcdef');
           *
           * // Passing a value that's a number, but not a valid byte.
           * // Prints: 2, equivalent to searching for 99 or 'c'.
           * console.log(b.lastIndexOf(99.9));
           * console.log(b.lastIndexOf(256 + 99));
           *
           * // Passing a byteOffset that coerces to NaN.
           * // Prints: 1, searching the whole buffer.
           * console.log(b.lastIndexOf('b', undefined));
           * console.log(b.lastIndexOf('b', {}));
           *
           * // Passing a byteOffset that coerces to 0.
           * // Prints: -1, equivalent to passing 0.
           * console.log(b.lastIndexOf('b', null));
           * console.log(b.lastIndexOf('b', []));
           * ```
           *
           * If `value` is an empty string or empty `Buffer`, `byteOffset` will be returned.
           * @param value What to search for.
           * @param [byteOffset=buf.length - 1] Where to begin searching in `buf`. If negative, then offset is calculated from the end of `buf`.
           * @param [encoding='utf8'] If `value` is a string, this is the encoding used to determine the binary representation of the string that will be searched for in `buf`.
           * @return The index of the last occurrence of `value` in `buf`, or `-1` if `buf` does not contain `value`.
           */
          lastIndexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): number;
          /**
           * Creates and returns an [iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) of `[index, byte]` pairs from the contents
           * of `buf`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * // Log the entire contents of a `Buffer`.
           *
           * const buf = Buffer.from('buffer');
           *
           * for (const pair of buf.entries()) {
           *   console.log(pair);
           * }
           * // Prints:
           * //   [0, 98]
           * //   [1, 117]
           * //   [2, 102]
           * //   [3, 102]
           * //   [4, 101]
           * //   [5, 114]
           * ```
           */
          entries(): IterableIterator<[number, number]>;
          /**
           * Equivalent to `buf.indexOf() !== -1`.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('this is a buffer');
           *
           * console.log(buf.includes('this'));
           * // Prints: true
           * console.log(buf.includes('is'));
           * // Prints: true
           * console.log(buf.includes(Buffer.from('a buffer')));
           * // Prints: true
           * console.log(buf.includes(97));
           * // Prints: true (97 is the decimal ASCII value for 'a')
           * console.log(buf.includes(Buffer.from('a buffer example')));
           * // Prints: false
           * console.log(buf.includes(Buffer.from('a buffer example').slice(0, 8)));
           * // Prints: true
           * console.log(buf.includes('this', 4));
           * // Prints: false
           * ```
           * @param value What to search for.
           * @param [byteOffset=0] Where to begin searching in `buf`. If negative, then offset is calculated from the end of `buf`.
           * @param [encoding='utf8'] If `value` is a string, this is its encoding.
           * @return `true` if `value` was found in `buf`, `false` otherwise.
           */
          includes(value: string | number | Buffer, byteOffset?: number, encoding?: BufferEncoding): boolean;
          /**
           * Creates and returns an [iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) of `buf` keys (indices).
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('buffer');
           *
           * for (const key of buf.keys()) {
           *   console.log(key);
           * }
           * // Prints:
           * //   0
           * //   1
           * //   2
           * //   3
           * //   4
           * //   5
           * ```
           */
          keys(): IterableIterator<number>;
          /**
           * Creates and returns an [iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) for `buf` values (bytes). This function is
           * called automatically when a `Buffer` is used in a `for..of` statement.
           *
           * ```js
           * import { Buffer } from 'buffer';
           *
           * const buf = Buffer.from('buffer');
           *
           * for (const value of buf.values()) {
           *   console.log(value);
           * }
           * // Prints:
           * //   98
           * //   117
           * //   102
           * //   102
           * //   101
           * //   114
           *
           * for (const value of buf) {
           *   console.log(value);
           * }
           * // Prints:
           * //   98
           * //   117
           * //   102
           * //   102
           * //   101
           * //   114
           * ```
           */
          values(): IterableIterator<number>;
      }
      var Buffer: BufferConstructor;
  }
}
declare module 'node:buffer' {
  export * from 'buffer';
}


// ./ffi.d.ts

/**
 * `bun:ffi` lets you efficiently call C functions & FFI functions from JavaScript
 *  without writing bindings yourself.
 *
 * ```js
 * import {dlopen, CString, ptr} from 'bun:ffi';
 *
 * const lib = dlopen('libsqlite3', {
 * });
 * ```
 *
 * This is powered by just-in-time compiling C wrappers
 * that convert JavaScript types to C types and back. Internally,
 * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
 * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
 *
 */
declare module "bun:ffi" {
  export enum FFIType {
    char = 0,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -127 and 127
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int8_t = 1,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -127 and 127
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i8 = 1,

    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint8_t = 2,
    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u8 = 2,

    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * in16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int16_t = 3,
    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * in16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i16 = 3,

    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint16_t = 4,
    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u16 = 4,

    /**
     * 32-bit signed integer
     *
     */
    int32_t = 5,

    /**
     * 32-bit signed integer
     *
     * Alias of {@link FFIType.int32_t}
     */
    i32 = 5,
    /**
     * 32-bit signed integer
     *
     * The same as `int` in C
     *
     * ```c
     * int
     * ```
     */
    int = 5,

    /**
     * 32-bit unsigned integer
     *
     * The same as `unsigned int` in C (on x64 & arm64)
     *
     * C:
     * ```c
     * unsigned int
     * ```
     * JavaScript:
     * ```js
     * ptr(new Uint32Array(1))
     * ```
     */
    uint32_t = 6,
    /**
     * 32-bit unsigned integer
     *
     * Alias of {@link FFIType.uint32_t}
     */
    u32 = 6,

    /**
     * int64 is a 64-bit signed integer
     *
     * This is not implemented yet!
     */
    int64_t = 7,
    /**
     * i64 is a 64-bit signed integer
     *
     * This is not implemented yet!
     */
    i64 = 7,

    /**
     * 64-bit unsigned integer
     *
     * This is not implemented yet!
     */
    uint64_t = 8,
    /**
     * 64-bit unsigned integer
     *
     * This is not implemented yet!
     */
    u64 = 8,

    /**
     * Doubles are not supported yet!
     */
    double = 9,
    /**
     * Doubles are not supported yet!
     */
    f64 = 9,
    /**
     * Floats are not supported yet!
     */
    float = 10,
    /**
     * Floats are not supported yet!
     */
    f32 = 10,

    /**
     * Booelan value
     *
     * Must be `true` or `false`. `0` and `1` type coercion is not supported.
     *
     * In C, this corresponds to:
     * ```c
     * bool
     * _Bool
     * ```
     *
     *
     */
    bool = 11,

    /**
     * Pointer value
     *
     * See {@link Bun.FFI.ptr} for more information
     *
     * In C:
     * ```c
     * void*
     * ```
     *
     * In JavaScript:
     * ```js
     * ptr(new Uint8Array(1))
     * ```
     */
    ptr = 12,
    /**
     * Pointer value
     *
     * alias of {@link FFIType.ptr}
     */
    pointer = 12,

    /**
     * void value
     *
     * void arguments are not supported
     *
     * void return type is the default return type
     *
     * In C:
     * ```c
     * void
     * ```
     *
     */
    void = 13,

    /**
     * When used as a `returns`, this will automatically become a {@link CString}.
     *
     * When used in `args` it is equivalent to {@link FFIType.pointer}
     *
     */
    cstring = 14,

    /**
     * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
     * but means you might get a `BigInt` or you might get a `number`.
     *
     * In C, this always becomes `int64_t`
     *
     * In JavaScript, this could be number or it could be BigInt, depending on what
     * value is passed in.
     *
     */
    i64_fast = 15,

    /**
     * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
     * but means you might get a `BigInt` or you might get a `number`.
     *
     * In C, this always becomes `uint64_t`
     *
     * In JavaScript, this could be number or it could be BigInt, depending on what
     * value is passed in.
     *
     */
    u64_fast = 16,
  }
  export type FFITypeOrString =
    | FFIType
    | "char"
    | "int8_t"
    | "i8"
    | "uint8_t"
    | "u8"
    | "int16_t"
    | "i16"
    | "uint16_t"
    | "u16"
    | "int32_t"
    | "i32"
    | "int"
    | "uint32_t"
    | "u32"
    | "int64_t"
    | "i64"
    | "uint64_t"
    | "u64"
    | "double"
    | "f64"
    | "float"
    | "f32"
    | "bool"
    | "ptr"
    | "pointer"
    | "void"
    | "cstring";

  interface FFIFunction {
    /**
     * Arguments to a FFI function (C ABI)
     *
     * Defaults to an empty array, which means no arguments.
     *
     * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
     *
     * @example
     * From JavaScript:
     * ```js
     * const lib = dlopen('add', {
     *    // FFIType can be used or you can pass string labels.
     *    args: [FFIType.i32, "i32"],
     *    returns: "i32",
     * });
     * lib.symbols.add(1, 2)
     * ```
     * In C:
     * ```c
     * int add(int a, int b) {
     *   return a + b;
     * }
     * ```
     */
    args?: FFITypeOrString[];
    /**
     * Return type to a FFI function (C ABI)
     *
     * Defaults to {@link FFIType.void}
     *
     * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
     *
     * @example
     * From JavaScript:
     * ```js
     * const lib = dlopen('z', {
     *    version: {
     *      returns: "ptr",
     *   }
     * });
     * console.log(new CString(lib.symbols.version()));
     * ```
     * In C:
     * ```c
     * char* version()
     * {
     *  return "1.0.0";
     * }
     * ```
     */
    returns?: FFITypeOrString;

    /**
     * Function pointer to the native function
     *
     * If provided, instead of using dlsym() to lookup the function, Bun will use this instead.
     * This pointer should not be null (0).
     *
     * This is useful if the library has already been loaded
     * or if the module is also using Node-API.
     */
    ptr?: number | bigint;
  }

  type Symbols = Record<string, FFIFunction>;

  // /**
  //  * Compile a callback function
  //  *
  //  * Returns a function pointer
  //  *
  //  */
  // export function callback(ffi: FFIFunction, cb: Function): number;

  export interface Library {
    symbols: Record<
      string,
      CallableFunction & {
        /**
         * The function without a wrapper
         */
        native: CallableFunction;
      }
    >;

    /**
     * `dlclose` the library, unloading the symbols and freeing allocated memory.
     *
     * Once called, the library is no longer usable.
     *
     * Calling a function from a library that has been closed is undefined behavior.
     */
    close(): void;
  }

  /**
   * Open a library using `"bun:ffi"`
   *
   * @param name The name of the library or file path. This will be passed to `dlopen()`
   * @param symbols Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
   *
   * @example
   *
   * ```js
   * import {dlopen} from 'bun:ffi';
   *
   * const lib = dlopen("duckdb.dylib", {
   *   get_version: {
   *     returns: "cstring",
   *     args: [],
   *   },
   * });
   * lib.symbols.get_version();
   * // "1.0.0"
   * ```
   *
   * This is powered by just-in-time compiling C wrappers
   * that convert JavaScript types to C types and back. Internally,
   * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
   * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
   *
   */
  export function dlopen(name: string, symbols: Symbols): Library;

  /**
   * Turn a native library's function pointer into a JavaScript function
   *
   * Libraries using Node-API & bun:ffi in the same module could use this to skip an extra dlopen() step.
   *
   * @param fn {@link FFIFunction} declaration. `ptr` is required
   *
   * @example
   *
   * ```js
   * import {CFunction} from 'bun:ffi';
   *
   * const getVersion = new CFunction({
   *   returns: "cstring",
   *   args: [],
   *   ptr: myNativeLibraryGetVersion,
   * });
   * getVersion();
   * getVersion.close();
   * ```
   *
   * This is powered by just-in-time compiling C wrappers
   * that convert JavaScript types to C types and back. Internally,
   * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
   * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
   *
   */
  export function CFunction(
    fn: FFIFunction & { ptr: number | bigint }
  ): CallableFunction & {
    /**
     * Free the memory allocated by the wrapping function
     */
    close(): void;
  };

  /**
   * Link a map of symbols to JavaScript functions
   *
   * This lets you use native libraries that were already loaded somehow. You usually will want {@link dlopen} instead.
   *
   * You could use this with Node-API to skip loading a second time.
   *
   * @param symbols Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
   *
   * @example
   *
   * ```js
   * import { linkSymbols } from "bun:ffi";
   *
   * const [majorPtr, minorPtr, patchPtr] = getVersionPtrs();
   *
   * const lib = linkSymbols({
   *   // Unlike with dlopen(), the names here can be whatever you want
   *   getMajor: {
   *     returns: "cstring",
   *     args: [],
   *
   *     // Since this doesn't use dlsym(), you have to provide a valid ptr
   *     // That ptr could be a number or a bigint
   *     // An invalid pointer will crash your program.
   *     ptr: majorPtr,
   *   },
   *   getMinor: {
   *     returns: "cstring",
   *     args: [],
   *     ptr: minorPtr,
   *   },
   *   getPatch: {
   *     returns: "cstring",
   *     args: [],
   *     ptr: patchPtr,
   *   },
   * });
   *
   * const [major, minor, patch] = [
   *   lib.symbols.getMajor(),
   *   lib.symbols.getMinor(),
   *   lib.symbols.getPatch(),
   * ];
   * ```
   *
   * This is powered by just-in-time compiling C wrappers
   * that convert JavaScript types to C types and back. Internally,
   * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
   * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
   *
   */
  export function linkSymbols(symbols: Symbols): Library;

  /**
   * Read a pointer as a {@link Buffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   *
   */
  export function toBuffer(
    ptr: number,
    byteOffset?: number,
    byteLength?: number
  ): Buffer;

  /**
   * Read a pointer as an {@link ArrayBuffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */
  export function toArrayBuffer(
    ptr: number,
    byteOffset?: number,
    byteLength?: number
  ): ArrayBuffer;

  /**
   * Get the pointer backing a {@link TypedArray} or {@link ArrayBuffer}
   *
   * Use this to pass {@link TypedArray} or {@link ArrayBuffer} to C functions.
   *
   * This is for use with FFI functions. For performance reasons, FFI will
   * not automatically convert typed arrays to C pointers.
   *
   * @param {TypedArray|ArrayBuffer|DataView} view the typed array or array buffer to get the pointer for
   * @param {number} byteOffset optional offset into the view in bytes
   *
   * @example
   *
   * From JavaScript:
   * ```js
   * const array = new Uint8Array(10);
   * const rawPtr = ptr(array);
   * myFFIFunction(rawPtr);
   * ```
   * To C:
   * ```c
   * void myFFIFunction(char* rawPtr) {
   *  // Do something with rawPtr
   * }
   * ```
   *
   */
  export function ptr(
    view: TypedArray | ArrayBufferLike | DataView,
    byteOffset?: number
  ): number;

  /**
   * Get a string from a UTF-8 encoded C string
   * If `byteLength` is not provided, the string is assumed to be null-terminated.
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * console.log(new CString(ptr));
   * ```
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * // print the first 4 characters
   * console.log(new CString(ptr, 0, 4));
   * ```
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */

  export class CString extends String {
    /**
     * Get a string from a UTF-8 encoded C string
     * If `byteLength` is not provided, the string is assumed to be null-terminated.
     *
     * @param ptr The pointer to the C string
     * @param byteOffset bytes to skip before reading
     * @param byteLength bytes to read
     *
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * console.log(new CString(ptr));
     * ```
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * // print the first 4 characters
     * console.log(new CString(ptr, 0, 4));
     * ```
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    constructor(ptr: number, byteOffset?: number, byteLength?: number);

    /**
     * The ptr to the C string
     *
     * This `CString` instance is a clone of the string, so it
     * is safe to continue using this instance after the `ptr` has been
     * freed.
     */
    ptr: number;
    byteOffset?: number;
    byteLength?: number;

    /**
     * Get the {@link ptr} as an `ArrayBuffer`
     *
     * `null` or empty ptrs returns an `ArrayBuffer` with `byteLength` 0
     */
    get arrayBuffer(): ArrayBuffer;
  }

  /**
   * View the generated C code for FFI bindings
   *
   * You probably won't need this unless there's a bug in the FFI bindings
   * generator or you're just curious.
   */
  export function viewSource(symbols: Symbols, is_callback?: false): string[];
  export function viewSource(callback: FFIFunction, is_callback: true): string;

  /**
   * Platform-specific file extension name for dynamic libraries
   *
   * "." is not included
   *
   * @example
   * ```js
   * "dylib" // macOS
   * ```
   *
   * @example
   * ```js
   * "so" // linux
   * ```
   */
  export const suffix: string;
}


// ./sqlite.d.ts

/**
 * Fast SQLite3 driver for Bun.js
 * @since v0.0.83
 *
 * @example
 * ```ts
 * import { Database } from 'bun:sqlite';
 *
 * var db = new Database('app.db');
 * db.query('SELECT * FROM users WHERE name = ?').all('John');
 * // => [{ id: 1, name: 'John' }]
 * ```
 *
 * The following types can be used when binding parameters:
 *
 * | JavaScript type | SQLite type |
 * | -------------- | ----------- |
 * | `string` | `TEXT` |
 * | `number` | `INTEGER` or `DECIMAL` |
 * | `boolean` | `INTEGER` (1 or 0) |
 * | `Uint8Array` | `BLOB` |
 * | `Buffer` | `BLOB` |
 * | `bigint` | `INTEGER` |
 * | `null` | `NULL` |
 */
declare module "bun:sqlite" {
  export class Database {
    /**
     * Open or create a SQLite3 database
     *
     * @param filename The filename of the database to open. Pass an empty string (`""`) or `":memory:"` or undefined for an in-memory database.
     * @param options defaults to `{readwrite: true, create: true}`. If a number, then it's treated as `SQLITE_OPEN_*` constant flags.
     *
     * @example
     *
     * ```ts
     * const db = new Database("mydb.sqlite");
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "baz");
     * console.log(db.query("SELECT * FROM foo").all());
     * ```
     *
     * @example
     *
     * Open an in-memory database
     *
     * ```ts
     * const db = new Database(":memory:");
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "hiiiiii");
     * console.log(db.query("SELECT * FROM foo").all());
     * ```
     *
     * @example
     *
     * Open read-only
     *
     * ```ts
     * const db = new Database("mydb.sqlite", {readonly: true});
     * ```
     */
    constructor(
      filename?: string,
      options?:
        | number
        | {
            /**
             * Open the database as read-only (no write operations, no create).
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
             */
            readonly?: boolean;
            /**
             * Allow creating a new database
             *
             * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
             */
            create?: boolean;
            /**
             * Open the database as read-write
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
             */
            readwrite?: boolean;
          }
    );

    /**
     * This is an alias of `new Database()`
     *
     * See {@link Database}
     */
    static open(
      filename: string,
      options?:
        | number
        | {
            /**
             * Open the database as read-only (no write operations, no create).
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
             */
            readonly?: boolean;
            /**
             * Allow creating a new database
             *
             * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
             */
            create?: boolean;
            /**
             * Open the database as read-write
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
             */
            readwrite?: boolean;
          }
    ): Database;

    /**
     * Execute a SQL query **without returning any results**.
     *
     * This does not cache the query, so if you want to run a query multiple times, you should use {@link prepare} instead.
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "baz");
     * ```
     *
     * Useful for queries like:
     * - `CREATE TABLE`
     * - `INSERT INTO`
     * - `UPDATE`
     * - `DELETE FROM`
     * - `DROP TABLE`
     * - `PRAGMA`
     * - `ATTACH DATABASE`
     * - `DETACH DATABASE`
     * - `REINDEX`
     * - `VACUUM`
     * - `EXPLAIN ANALYZE`
     * - `CREATE INDEX`
     * - `CREATE TRIGGER`
     * - `CREATE VIEW`
     * - `CREATE VIRTUAL TABLE`
     * - `CREATE TEMPORARY TABLE`
     *
     * @param sql The SQL query to run
     *
     * @param bindings Optional bindings for the query
     *
     * @returns `Database` instance
     *
     * Under the hood, this calls `sqlite3_prepare_v3` followed by `sqlite3_step` and `sqlite3_finalize`.
     *
     *  * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     */
    run<ParamsType = SQLQueryBindings>(
      sqlQuery: string,
      ...bindings: ParamsType[]
    ): void;
    /** 
        This is an alias of {@link Database.prototype.run}
     */
    exec<ParamsType = SQLQueryBindings>(
      sqlQuery: string,
      ...bindings: ParamsType[]
    ): void;

    /**
     * Compile a SQL query and return a {@link Statement} object. This is the
     * same as {@link prepare} except that it caches the compiled query.
     *
     * This **does not execute** the query, but instead prepares it for later
     * execution and caches the compiled query if possible.
     *
     * @example
     * ```ts
     * // compile the query
     * const stmt = db.query("SELECT * FROM foo WHERE bar = ?");
     * // run the query
     * stmt.all("baz");
     *
     * // run the query again
     * stmt.all();
     * ```
     *
     * @param sql The SQL query to compile
     *
     * @returns `Statment` instance
     *
     * Under the hood, this calls `sqlite3_prepare_v3`.
     *
     */
    query<ParamsType = SQLQueryBindings, ReturnType = any>(
      sqlQuery: string
    ): Statement<ParamsType, ReturnType>;

    /**
     * Compile a SQL query and return a {@link Statement} object.
     *
     * This does not cache the compiled query and does not execute the query.
     *
     * @example
     * ```ts
     * // compile the query
     * const stmt = db.query("SELECT * FROM foo WHERE bar = ?");
     * // run the query
     * stmt.all("baz");
     * ```
     *
     * @param sql The SQL query to compile
     * @param params Optional bindings for the query
     *
     * @returns `Statment` instance
     *
     * Under the hood, this calls `sqlite3_prepare_v3`.
     *
     */
    prepare<ParamsType = SQLQueryBindings, ReturnType = any>(
      sql: string,
      ...params: ParamsType[]
    ): Statement<ParamsType, ReturnType>;

    /**
     * Is the database in a transaction?
     *
     * @returns `true` if the database is in a transaction, `false` otherwise
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", "baz");
     * db.run("BEGIN");
     * db.run("INSERT INTO foo VALUES (?)", "qux");
     * console.log(db.inTransaction());
     * ```
     */
    get inTransaction(): boolean;

    /**
     * Close the database connection.
     *
     * It is safe to call this method multiple times. If the database is already
     * closed, this is a no-op. Running queries after the database has been
     * closed will throw an error.
     *
     * @example
     * ```ts
     * db.close();
     * ```
     * This is called automatically when the database instance is garbage collected.
     *
     * Internally, this calls `sqlite3_close_v2`.
     */
    close(): void;

    /**
     * The filename passed when `new Database()` was called
     * @example
     * ```ts
     * const db = new Database("mydb.sqlite");
     * console.log(db.filename);
     * // => "mydb.sqlite"
     * ```
     */
    readonly filename: string;

    /**
     * The underlying `sqlite3` database handle
     *
     * In native code, this is not a file descriptor, but an index into an array of database handles
     */
    readonly handle: number;

    /**
     * Load a SQLite3 extension
     *
     * macOS requires a custom SQLite3 library to be linked because the Apple build of SQLite for macOS disables loading extensions. See {@link Database.setCustomSQLite}
     *
     * Bun chooses the Apple build of SQLite on macOS because it brings a ~50% performance improvement.
     *
     * @param extension name/path of the extension to load
     * @param entryPoint optional entry point of the extension
     */
    loadExtension(extension, entryPoint?: string): void;

    /**
     * Change the dynamic library path to SQLite
     *
     * @note macOS-only
     *
     * This only works before SQLite is loaded, so
     * that's before you call `new Database()`.
     *
     * It can only be run once because this will load
     * the SQLite library into the process.
     *
     * @param path The path to the SQLite library
     *
     */
    static setCustomSQLite(path: string): boolean;

    /**
     * Creates a function that always runs inside a transaction. When the
     * function is invoked, it will begin a new transaction. When the function
     * returns, the transaction will be committed. If an exception is thrown,
     * the transaction will be rolled back (and the exception will propagate as
     * usual).
     *
     * @param insideTransaction The callback which runs inside a transaction
     *
     * @example
     * ```ts
     * // setup
     * import { Database } from "bun:sqlite";
     * const db = Database.open(":memory:");
     * db.exec(
     *   "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)"
     * );
     *
     * const insert = db.prepare("INSERT INTO cats (name, age) VALUES ($name, $age)");
     * const insertMany = db.transaction((cats) => {
     *   for (const cat of cats) insert.run(cat);
     * });
     *
     * insertMany([
     *   { $name: "Joey", $age: 2 },
     *   { $name: "Sally", $age: 4 },
     *   { $name: "Junior", $age: 1 },
     * ]);
     * ```
     */
    transaction(insideTransaction: (...args: any) => void): CallableFunction & {
      /**
       * uses "BEGIN DEFERRED"
       */
      deferred: (...args: any) => void;
      /**
       * uses "BEGIN IMMEDIATE"
       */
      immediate: (...args: any) => void;
      /**
       * uses "BEGIN EXCLUSIVE"
       */
      exclusive: (...args: any) => void;
    };
  }

  /**
   * A prepared statement.
   *
   * This is returned by {@link Database.prepare} and {@link Database.query}.
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.all("baz");
   * // => [{bar: "baz"}]
   * ```
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.get("baz");
   * // => {bar: "baz"}
   * ```
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.run("baz");
   * // => undefined
   * ```
   */
  export class Statement<ParamsType = SQLQueryBindings, ReturnType = any> {
    /**
     * Creates a new prepared statement from native code.
     *
     * This is used internally by the {@link Database} class. Probably you don't need to call this yourself.
     */
    constructor(nativeHandle: any);

    /**
     * Execute the prepared statement and return all results as objects.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.all("baz");
     * // => [{bar: "baz"}]
     *
     * stmt.all();
     * // => [{bar: "baz"}]
     *
     * stmt.all("foo");
     * // => [{bar: "foo"}]
     * ```
     */
    all(...params: ParamsType[]): ReturnType[];

    /**
     * Execute the prepared statement and return **the first** result.
     *
     * If no result is returned, this returns `null`.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.all("baz");
     * // => [{bar: "baz"}]
     *
     * stmt.all();
     * // => [{bar: "baz"}]
     *
     * stmt.all("foo");
     * // => [{bar: "foo"}]
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     *
     */
    get(...params: ParamsType[]): ReturnType | null;

    /**
     * Execute the prepared statement. This returns `undefined`.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("UPDATE foo SET bar = ?");
     * stmt.run("baz");
     * // => undefined
     *
     * stmt.run();
     * // => undefined
     *
     * stmt.run("foo");
     * // => undefined
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     *
     */
    run(...params: ParamsType[]): void;

    /**
     * Execute the prepared statement and return the results as an array of arrays.
     *
     * This is a little faster than {@link all}.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.values("baz");
     * // => [['baz']]
     *
     * stmt.values();
     * // => [['baz']]
     *
     * stmt.values("foo");
     * // => [['foo']]
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type |
     * | -------------- | ----------- |
     * | `string` | `TEXT` |
     * | `number` | `INTEGER` or `DECIMAL` |
     * | `boolean` | `INTEGER` (1 or 0) |
     * | `Uint8Array` | `BLOB` |
     * | `Buffer` | `BLOB` |
     * | `bigint` | `INTEGER` |
     * | `null` | `NULL` |
     *
     */
    values(
      ...params: ParamsType[]
    ): Array<Array<string | bigint | number | boolean | Uint8Array>>;

    /**
     * The names of the columns returned by the prepared statement.
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT bar FROM foo WHERE bar = ?");
     *
     * console.log(stmt.columnNames);
     * // => ["bar"]
     * ```
     */
    readonly columnNames: string[];

    /**
     * The number of parameters expected in the prepared statement.
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     * console.log(stmt.paramsCount);
     * // => 1
     * ```
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ? AND baz = ?");
     * console.log(stmt.paramsCount);
     * // => 2
     * ```
     *
     */
    readonly paramsCount: number;

    /**
     * Finalize the prepared statement, freeing the resources used by the
     * statement and preventing it from being executed again.
     *
     * This is called automatically when the prepared statement is garbage collected.
     *
     * It is safe to call this multiple times. Calling this on a finalized
     * statement has no effect.
     *
     * Internally, this calls `sqlite3_finalize`.
     */
    finalize(): void;

    /**
     * Return the expanded SQL string for the prepared statement.
     *
     * Internally, this calls `sqlite3_expanded_sql()` on the underlying `sqlite3_stmt`.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?", "baz");
     * console.log(stmt.toString());
     * // => "SELECT * FROM foo WHERE bar = 'baz'"
     * console.log(stmt);
     * // => "SELECT * FROM foo WHERE bar = 'baz'"
     * ```
     */
    toString(): string;

    /**
     * Native object representing the underlying `sqlite3_stmt`
     *
     * This is left untyped because the ABI of the native bindings may change at any time.
     */
    readonly native: any;
  }

  /**
   * Constants from `sqlite3.h`
   *
   * This list isn't exhaustive, but some of the ones which are relevant
   */
  export const constants: {
    /**
     * Open the database as read-only (no write operations, no create).
     * @value 0x00000001
     */
    SQLITE_OPEN_READONLY: number;
    /**
     * Open the database for reading and writing
     * @value 0x00000002
     */
    SQLITE_OPEN_READWRITE: number;
    /**
     * Allow creating a new database
     * @value 0x00000004
     */
    SQLITE_OPEN_CREATE: number;
    /**
     *
     * @value 0x00000008
     */
    SQLITE_OPEN_DELETEONCLOSE: number;
    /**
     *
     * @value 0x00000010
     */
    SQLITE_OPEN_EXCLUSIVE: number;
    /**
     *
     * @value 0x00000020
     */
    SQLITE_OPEN_AUTOPROXY: number;
    /**
     *
     * @value 0x00000040
     */
    SQLITE_OPEN_URI: number;
    /**
     *
     * @value 0x00000080
     */
    SQLITE_OPEN_MEMORY: number;
    /**
     *
     * @value 0x00000100
     */
    SQLITE_OPEN_MAIN_DB: number;
    /**
     *
     * @value 0x00000200
     */
    SQLITE_OPEN_TEMP_DB: number;
    /**
     *
     * @value 0x00000400
     */
    SQLITE_OPEN_TRANSIENT_DB: number;
    /**
     *
     * @value 0x00000800
     */
    SQLITE_OPEN_MAIN_JOURNAL: number;
    /**
     *
     * @value 0x00001000
     */
    SQLITE_OPEN_TEMP_JOURNAL: number;
    /**
     *
     * @value 0x00002000
     */
    SQLITE_OPEN_SUBJOURNAL: number;
    /**
     *
     * @value 0x00004000
     */
    SQLITE_OPEN_SUPER_JOURNAL: number;
    /**
     *
     * @value 0x00008000
     */
    SQLITE_OPEN_NOMUTEX: number;
    /**
     *
     * @value 0x00010000
     */
    SQLITE_OPEN_FULLMUTEX: number;
    /**
     *
     * @value 0x00020000
     */
    SQLITE_OPEN_SHAREDCACHE: number;
    /**
     *
     * @value 0x00040000
     */
    SQLITE_OPEN_PRIVATECACHE: number;
    /**
     *
     * @value 0x00080000
     */
    SQLITE_OPEN_WAL: number;
    /**
     *
     * @value 0x01000000
     */
    SQLITE_OPEN_NOFOLLOW: number;
    /**
     *
     * @value 0x02000000
     */
    SQLITE_OPEN_EXRESCODE: number;
    /**
     *
     * @value 0x01
     */
    SQLITE_PREPARE_PERSISTENT: number;
    /**
     *
     * @value 0x02
     */
    SQLITE_PREPARE_NORMALIZE: number;
    /**
     *
     * @value 0x04
     */
    SQLITE_PREPARE_NO_VTAB: number;
  };

  /**
   * The native module implementing the sqlite3 C bindings
   *
   * It is lazily-initialized, so this will return `undefined` until the first
   * call to new Database().
   *
   * The native module makes no gurantees about ABI stability, so it is left
   * untyped
   *
   * If you need to use it directly for some reason, please let us know because
   * that probably points to a deficiency in this API.
   *
   */
  export var native: any;

  export type SQLQueryBindings =
    | string
    | bigint
    | TypedArray
    | number
    | boolean
    | null
    | Record<string, string | bigint | TypedArray | number | boolean | null>;

  export default Database;
}


// ./fs.d.ts

/**
 * The `fs` module enables interacting with the file system in a
 * way modeled on standard POSIX functions.
 *
 * ```js
 * import * as fs from 'fs';
 * ```
 *
 * All file system operations have synchronous and callback
 * forms, and are accessible using both CommonJS syntax and ES6 Modules (ESM).
 */
declare module "fs" {
  import type { SystemError } from "bun";

  interface ObjectEncodingOptions {
    encoding?: BufferEncoding | null | undefined;
  }
  type EncodingOption =
    | ObjectEncodingOptions
    | BufferEncoding
    | undefined
    | null;
  type OpenMode = number | string;
  type Mode = number | string;
  interface StatsBase<T> {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: T;
    ino: T;
    mode: T;
    nlink: T;
    uid: T;
    gid: T;
    rdev: T;
    size: T;
    blksize: T;
    blocks: T;
    atimeMs: T;
    mtimeMs: T;
    ctimeMs: T;
    birthtimeMs: T;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
  }
  interface Stats extends StatsBase<number> {}
  /**
   * A `fs.Stats` object provides information about a file.
   *
   * Objects returned from {@link stat}, {@link lstat} and {@link fstat} and
   * their synchronous counterparts are of this type.
   * If `bigint` in the `options` passed to those methods is true, the numeric values
   * will be `bigint` instead of `number`, and the object will contain additional
   * nanosecond-precision properties suffixed with `Ns`.
   *
   * ```console
   * Stats {
   *   dev: 2114,
   *   ino: 48064969,
   *   mode: 33188,
   *   nlink: 1,
   *   uid: 85,
   *   gid: 100,
   *   rdev: 0,
   *   size: 527,
   *   blksize: 4096,
   *   blocks: 8,
   *   atimeMs: 1318289051000.1,
   *   mtimeMs: 1318289051000.1,
   *   ctimeMs: 1318289051000.1,
   *   birthtimeMs: 1318289051000.1,
   *   atime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   mtime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   ctime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   birthtime: Mon, 10 Oct 2011 23:24:11 GMT }
   * ```
   *
   * `bigint` version:
   *
   * ```console
   * BigIntStats {
   *   dev: 2114n,
   *   ino: 48064969n,
   *   mode: 33188n,
   *   nlink: 1n,
   *   uid: 85n,
   *   gid: 100n,
   *   rdev: 0n,
   *   size: 527n,
   *   blksize: 4096n,
   *   blocks: 8n,
   *   atimeMs: 1318289051000n,
   *   mtimeMs: 1318289051000n,
   *   ctimeMs: 1318289051000n,
   *   birthtimeMs: 1318289051000n,
   *   atimeNs: 1318289051000000000n,
   *   mtimeNs: 1318289051000000000n,
   *   ctimeNs: 1318289051000000000n,
   *   birthtimeNs: 1318289051000000000n,
   *   atime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   mtime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   ctime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   birthtime: Mon, 10 Oct 2011 23:24:11 GMT }
   * ```
   * @since v0.0.67
   */
  class Stats {}
  /**
   * A representation of a directory entry, which can be a file or a subdirectory
   * within the directory, as returned by reading from an `fs.Dir`. The
   * directory entry is a combination of the file name and file type pairs.
   *
   * Additionally, when {@link readdir} or {@link readdirSync} is called with
   * the `withFileTypes` option set to `true`, the resulting array is filled with `fs.Dirent` objects, rather than strings or `Buffer` s.
   * @since v0.0.67
   */
  class Dirent {
    /**
     * Returns `true` if the `fs.Dirent` object describes a regular file.
     * @since v0.0.67
     */
    isFile(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a file system
     * directory.
     * @since v0.0.67
     */
    isDirectory(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a block device.
     * @since v0.0.67
     */
    isBlockDevice(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a character device.
     * @since v0.0.67
     */
    isCharacterDevice(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a symbolic link.
     * @since v0.0.67
     */
    isSymbolicLink(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a first-in-first-out
     * (FIFO) pipe.
     * @since v0.0.67
     */
    isFIFO(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a socket.
     * @since v0.0.67
     */
    isSocket(): boolean;
    /**
     * The file name that this `fs.Dirent` object refers to. The type of this
     * value is determined by the `options.encoding` passed to {@link readdir} or {@link readdirSync}.
     * @since v0.0.67
     */
    name: string;
  }

  /**
   * Asynchronously rename file at `oldPath` to the pathname provided
   * as `newPath`. In the case that `newPath` already exists, it will
   * be overwritten. If there is a directory at `newPath`, an error will
   * be raised instead. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * See also: [`rename(2)`](http://man7.org/linux/man-pages/man2/rename.2.html).
   *
   * ```js
   * import { rename } from 'fs';
   *
   * rename('oldFile.txt', 'newFile.txt', (err) => {
   *   if (err) throw err;
   *   console.log('Rename complete!');
   * });
   * ```
   * @since v0.0.67
   */
  function rename(
    oldPath: PathLike,
    newPath: PathLike,
    callback: NoParamCallback
  ): void;
  // namespace rename {
  //   /**
  //    * Asynchronous rename(2) - Change the name or location of a file or directory.
  //    * @param oldPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * @param newPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    */
  //   function __promisify__(oldPath: PathLike, newPath: PathLike): Promise<void>;
  // }
  /**
   * Renames the file from `oldPath` to `newPath`. Returns `undefined`.
   *
   * See the POSIX [`rename(2)`](http://man7.org/linux/man-pages/man2/rename.2.html) documentation for more details.
   * @since v0.0.67
   */
  function renameSync(oldPath: PathLike, newPath: PathLike): void;
  /**
   * Truncates the file. No arguments other than a possible exception are
   * given to the completion callback. A file descriptor can also be passed as the
   * first argument. In this case, `fs.ftruncate()` is called.
   *
   * ```js
   * import { truncate } from 'fs';
   * // Assuming that 'path/file.txt' is a regular file.
   * truncate('path/file.txt', (err) => {
   *   if (err) throw err;
   *   console.log('path/file.txt was truncated');
   * });
   * ```
   *
   * Passing a file descriptor is deprecated and may result in an error being thrown
   * in the future.
   *
   * See the POSIX [`truncate(2)`](http://man7.org/linux/man-pages/man2/truncate.2.html) documentation for more details.
   * @since v0.0.67
   * @param [len=0]
   */
  function truncate(
    path: PathLike,
    len: number | undefined | null,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous truncate(2) - Truncate a file to a specified length.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function truncate(path: PathLike, callback: NoParamCallback): void;
  // namespace truncate {
  //   /**
  //    * Asynchronous truncate(2) - Truncate a file to a specified length.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param len If not specified, defaults to `0`.
  //    */
  //   function __promisify__(path: PathLike, len?: number | null): Promise<void>;
  // }
  /**
   * Truncates the file. Returns `undefined`. A file descriptor can also be
   * passed as the first argument. In this case, `fs.ftruncateSync()` is called.
   *
   * Passing a file descriptor is deprecated and may result in an error being thrown
   * in the future.
   * @since v0.0.67
   * @param [len=0]
   */
  function truncateSync(path: PathLike, len?: number | null): void;
  /**
   * Truncates the file descriptor. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * See the POSIX [`ftruncate(2)`](http://man7.org/linux/man-pages/man2/ftruncate.2.html) documentation for more detail.
   *
   * If the file referred to by the file descriptor was larger than `len` bytes, only
   * the first `len` bytes will be retained in the file.
   *
   * For example, the following program retains only the first four bytes of the
   * file:
   *
   * ```js
   * import { open, close, ftruncate } from 'fs';
   *
   * function closeFd(fd) {
   *   close(fd, (err) => {
   *     if (err) throw err;
   *   });
   * }
   *
   * open('temp.txt', 'r+', (err, fd) => {
   *   if (err) throw err;
   *
   *   try {
   *     ftruncate(fd, 4, (err) => {
   *       closeFd(fd);
   *       if (err) throw err;
   *     });
   *   } catch (err) {
   *     closeFd(fd);
   *     if (err) throw err;
   *   }
   * });
   * ```
   *
   * If the file previously was shorter than `len` bytes, it is extended, and the
   * extended part is filled with null bytes (`'\0'`):
   *
   * If `len` is negative then `0` will be used.
   * @since v0.0.67
   * @param [len=0]
   */
  function ftruncate(
    fd: number,
    len: number | undefined | null,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous ftruncate(2) - Truncate a file to a specified length.
   * @param fd A file descriptor.
   */
  function ftruncate(fd: number, callback: NoParamCallback): void;
  // namespace ftruncate {
  //   /**
  //    * Asynchronous ftruncate(2) - Truncate a file to a specified length.
  //    * @param fd A file descriptor.
  //    * @param len If not specified, defaults to `0`.
  //    */
  //   function __promisify__(fd: number, len?: number | null): Promise<void>;
  // }
  /**
   * Truncates the file descriptor. Returns `undefined`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link ftruncate}.
   * @since v0.0.67
   * @param [len=0]
   */
  function ftruncateSync(fd: number, len?: number | null): void;
  /**
   * Asynchronously changes owner and group of a file. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * See the POSIX [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function chown(
    path: PathLike,
    uid: number,
    gid: number,
    callback: NoParamCallback
  ): void;
  // namespace chown {
  //   /**
  //    * Asynchronous chown(2) - Change ownership of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     uid: number,
  //     gid: number
  //   ): Promise<void>;
  // }
  /**
   * Synchronously changes owner and group of a file. Returns `undefined`.
   * This is the synchronous version of {@link chown}.
   *
   * See the POSIX [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function chownSync(path: PathLike, uid: number, gid: number): void;
  /**
   * Sets the owner of the file. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * See the POSIX [`fchown(2)`](http://man7.org/linux/man-pages/man2/fchown.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fchown(
    fd: number,
    uid: number,
    gid: number,
    callback: NoParamCallback
  ): void;
  // namespace fchown {
  //   /**
  //    * Asynchronous fchown(2) - Change ownership of a file.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number, uid: number, gid: number): Promise<void>;
  // }
  /**
   * Sets the owner of the file. Returns `undefined`.
   *
   * See the POSIX [`fchown(2)`](http://man7.org/linux/man-pages/man2/fchown.2.html) documentation for more detail.
   * @since v0.0.67
   * @param uid The file's new owner's user id.
   * @param gid The file's new group's group id.
   */
  function fchownSync(fd: number, uid: number, gid: number): void;
  /**
   * Set the owner of the symbolic link. No arguments other than a possible
   * exception are given to the completion callback.
   *
   * See the POSIX [`lchown(2)`](http://man7.org/linux/man-pages/man2/lchown.2.html) documentation for more detail.
   */
  function lchown(
    path: PathLike,
    uid: number,
    gid: number,
    callback: NoParamCallback
  ): void;
  // namespace lchown {
  //   /**
  //    * Asynchronous lchown(2) - Change ownership of a file. Does not dereference symbolic links.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     uid: number,
  //     gid: number
  //   ): Promise<void>;
  // }
  /**
   * Set the owner for the path. Returns `undefined`.
   *
   * See the POSIX [`lchown(2)`](http://man7.org/linux/man-pages/man2/lchown.2.html) documentation for more details.
   * @param uid The file's new owner's user id.
   * @param gid The file's new group's group id.
   */
  function lchownSync(path: PathLike, uid: number, gid: number): void;
  /**
   * Changes the access and modification times of a file in the same way as {@link utimes}, with the difference that if the path refers to a symbolic
   * link, then the link is not dereferenced: instead, the timestamps of the
   * symbolic link itself are changed.
   *
   * No arguments other than a possible exception are given to the completion
   * callback.
   * @since v0.0.67
   */
  function lutimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
    callback: NoParamCallback
  ): void;
  // namespace lutimes {
  //   /**
  //    * Changes the access and modification times of a file in the same way as `fsPromises.utimes()`,
  //    * with the difference that if the path refers to a symbolic link, then the link is not
  //    * dereferenced: instead, the timestamps of the symbolic link itself are changed.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param atime The last access time. If a string is provided, it will be coerced to number.
  //    * @param mtime The last modified time. If a string is provided, it will be coerced to number.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     atime: TimeLike,
  //     mtime: TimeLike
  //   ): Promise<void>;
  // }
  /**
   * Change the file system timestamps of the symbolic link referenced by `path`.
   * Returns `undefined`, or throws an exception when parameters are incorrect or
   * the operation fails. This is the synchronous version of {@link lutimes}.
   * @since v0.0.67
   */
  function lutimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
  /**
   * Asynchronously changes the permissions of a file. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * See the POSIX [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html) documentation for more detail.
   *
   * ```js
   * import { chmod } from 'fs';
   *
   * chmod('my_file.txt', 0o775, (err) => {
   *   if (err) throw err;
   *   console.log('The permissions for file "my_file.txt" have been changed!');
   * });
   * ```
   * @since v0.0.67
   */
  function chmod(path: PathLike, mode: Mode, callback: NoParamCallback): void;
  // namespace chmod {
  //   /**
  //    * Asynchronous chmod(2) - Change permissions of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
  //    */
  //   function __promisify__(path: PathLike, mode: Mode): Promise<void>;
  // }
  /**
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link chmod}.
   *
   * See the POSIX [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function chmodSync(path: PathLike, mode: Mode): void;
  /**
   * Sets the permissions on the file. No arguments other than a possible exception
   * are given to the completion callback.
   *
   * See the POSIX [`fchmod(2)`](http://man7.org/linux/man-pages/man2/fchmod.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fchmod(fd: number, mode: Mode, callback: NoParamCallback): void;
  // namespace fchmod {
  //   /**
  //    * Asynchronous fchmod(2) - Change permissions of a file.
  //    * @param fd A file descriptor.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
  //    */
  //   function __promisify__(fd: number, mode: Mode): Promise<void>;
  // }
  /**
   * Sets the permissions on the file. Returns `undefined`.
   *
   * See the POSIX [`fchmod(2)`](http://man7.org/linux/man-pages/man2/fchmod.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fchmodSync(fd: number, mode: Mode): void;
  /**
   * Changes the permissions on a symbolic link. No arguments other than a possible
   * exception are given to the completion callback.
   *
   * This method is only implemented on macOS.
   *
   * See the POSIX [`lchmod(2)`](https://www.freebsd.org/cgi/man.cgi?query=lchmod&sektion=2) documentation for more detail.
   * @deprecated Since v0.4.7
   */
  function lchmod(path: PathLike, mode: Mode, callback: NoParamCallback): void;
  // /** @deprecated */
  // namespace lchmod {
  //   /**
  //    * Asynchronous lchmod(2) - Change permissions of a file. Does not dereference symbolic links.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
  //    */
  //   function __promisify__(path: PathLike, mode: Mode): Promise<void>;
  // }
  /**
   * Changes the permissions on a symbolic link. Returns `undefined`.
   *
   * This method is only implemented on macOS.
   *
   * See the POSIX [`lchmod(2)`](https://www.freebsd.org/cgi/man.cgi?query=lchmod&sektion=2) documentation for more detail.
   * @deprecated Since v0.4.7
   */
  function lchmodSync(path: PathLike, mode: Mode): void;
  /**
   * Asynchronous [`stat(2)`](http://man7.org/linux/man-pages/man2/stat.2.html). The callback gets two arguments `(err, stats)` where`stats` is an `fs.Stats` object.
   *
   * In case of an error, the `err.code` will be one of `Common System Errors`.
   *
   * Using `fs.stat()` to check for the existence of a file before calling`fs.open()`, `fs.readFile()` or `fs.writeFile()` is not recommended.
   * Instead, user code should open/read/write the file directly and handle the
   * error raised if the file is not available.
   *
   * To check if a file exists without manipulating it afterwards, {@link access} is recommended.
   *
   * For example, given the following directory structure:
   *
   * ```text
   * - txtDir
   * -- file.txt
   * - app.js
   * ```
   *
   * The next program will check for the stats of the given paths:
   *
   * ```js
   * import { stat } from 'fs';
   *
   * const pathsToCheck = ['./txtDir', './txtDir/file.txt'];
   *
   * for (let i = 0; i < pathsToCheck.length; i++) {
   *   stat(pathsToCheck[i], (err, stats) => {
   *     console.log(stats.isDirectory());
   *     console.log(stats);
   *   });
   * }
   * ```
   *
   * The resulting output will resemble:
   *
   * ```console
   * true
   * Stats {
   *   dev: 16777220,
   *   mode: 16877,
   *   nlink: 3,
   *   uid: 501,
   *   gid: 20,
   *   rdev: 0,
   *   blksize: 4096,
   *   ino: 14214262,
   *   size: 96,
   *   blocks: 0,
   *   atimeMs: 1561174653071.963,
   *   mtimeMs: 1561174614583.3518,
   *   ctimeMs: 1561174626623.5366,
   *   birthtimeMs: 1561174126937.2893,
   *   atime: 2019-06-22T03:37:33.072Z,
   *   mtime: 2019-06-22T03:36:54.583Z,
   *   ctime: 2019-06-22T03:37:06.624Z,
   *   birthtime: 2019-06-22T03:28:46.937Z
   * }
   * false
   * Stats {
   *   dev: 16777220,
   *   mode: 33188,
   *   nlink: 1,
   *   uid: 501,
   *   gid: 20,
   *   rdev: 0,
   *   blksize: 4096,
   *   ino: 14214074,
   *   size: 8,
   *   blocks: 8,
   *   atimeMs: 1561174616618.8555,
   *   mtimeMs: 1561174614584,
   *   ctimeMs: 1561174614583.8145,
   *   birthtimeMs: 1561174007710.7478,
   *   atime: 2019-06-22T03:36:56.619Z,
   *   mtime: 2019-06-22T03:36:54.584Z,
   *   ctime: 2019-06-22T03:36:54.584Z,
   *   birthtime: 2019-06-22T03:26:47.711Z
   * }
   * ```
   * @since v0.0.67
   */
  function stat(
    path: PathLike,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function stat(
    path: PathLike,
    options:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function stat(
    path: PathLike,
    options: StatOptions & {
      bigint: true;
    },
    callback: (err: SystemError | null, stats: BigIntStats) => void
  ): void;
  function stat(
    path: PathLike,
    options: StatOptions | undefined,
    callback: (err: SystemError | null, stats: Stats | BigIntStats) => void
  ): void;
  // namespace stat {
  //   /**
  //    * Asynchronous stat(2) - Get file status.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions & {
  //       bigint?: false | undefined;
  //     }
  //   ): Promise<Stats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options: StatOptions & {
  //       bigint: true;
  //     }
  //   ): Promise<BigIntStats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions
  //   ): Promise<Stats | BigIntStats>;
  // }
  // tslint:disable-next-line:unified-signatures
  interface StatSyncFn extends Function {
    // tslint:disable-next-line:unified-signatures
    (path: PathLike, options?: undefined): Stats;
    (
      path: PathLike,
      options?: StatSyncOptions & {
        bigint?: false | undefined;
        throwIfNoEntry: false;
      }
    ): Stats | undefined;
    (
      path: PathLike,
      options: StatSyncOptions & {
        bigint: true;
        throwIfNoEntry: false;
      }
    ): BigIntStats | undefined;
    // tslint:disable-next-line:unified-signatures
    (
      path: PathLike,
      // tslint:disable-next-line:unified-signatures
      options?: StatSyncOptions & {
        bigint?: false | undefined;
      }
    ): Stats;
    (
      path: PathLike,
      options: StatSyncOptions & {
        bigint: true;
      }
    ): BigIntStats;
    (
      path: PathLike,
      options: StatSyncOptions & {
        bigint: boolean;
        throwIfNoEntry?: false | undefined;
      }
    ): Stats | BigIntStats;
    (path: PathLike, options?: StatSyncOptions):
      | Stats
      | BigIntStats
      | undefined;
  }
  /**
   * Synchronous stat(2) - Get file status.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  var statSync: StatSyncFn;
  /**
   * Invokes the callback with the `fs.Stats` for the file descriptor.
   *
   * See the POSIX [`fstat(2)`](http://man7.org/linux/man-pages/man2/fstat.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fstat(
    fd: number,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function fstat(
    fd: number,
    options:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function fstat(
    fd: number,
    options: StatOptions & {
      bigint: true;
    },
    callback: (err: SystemError | null, stats: BigIntStats) => void
  ): void;
  function fstat(
    fd: number,
    options: StatOptions | undefined,
    callback: (err: SystemError | null, stats: Stats | BigIntStats) => void
  ): void;
  // namespace fstat {
  //   /**
  //    * Asynchronous fstat(2) - Get file status.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(
  //     fd: number,
  //     options?: StatOptions & {
  //       bigint?: false | undefined;
  //     }
  //   ): Promise<Stats>;
  //   function __promisify__(
  //     fd: number,
  //     options: StatOptions & {
  //       bigint: true;
  //     }
  //   ): Promise<BigIntStats>;
  //   function __promisify__(
  //     fd: number,
  //     options?: StatOptions
  //   ): Promise<Stats | BigIntStats>;
  // }
  /**
   * Retrieves the `fs.Stats` for the file descriptor.
   *
   * See the POSIX [`fstat(2)`](http://man7.org/linux/man-pages/man2/fstat.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fstatSync(
    fd: number,
    options?: StatOptions & {
      bigint?: false | undefined;
    }
  ): Stats;
  function fstatSync(
    fd: number,
    options: StatOptions & {
      bigint: true;
    }
  ): BigIntStats;
  function fstatSync(fd: number, options?: StatOptions): Stats | BigIntStats;
  /**
   * Retrieves the `fs.Stats` for the symbolic link referred to by the path.
   * The callback gets two arguments `(err, stats)` where `stats` is a `fs.Stats` object. `lstat()` is identical to `stat()`, except that if `path` is a symbolic
   * link, then the link itself is stat-ed, not the file that it refers to.
   *
   * See the POSIX [`lstat(2)`](http://man7.org/linux/man-pages/man2/lstat.2.html) documentation for more details.
   * @since v0.0.67
   */
  function lstat(
    path: PathLike,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function lstat(
    path: PathLike,
    options:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function lstat(
    path: PathLike,
    options: StatOptions & {
      bigint: true;
    },
    callback: (err: SystemError | null, stats: BigIntStats) => void
  ): void;
  function lstat(
    path: PathLike,
    options: StatOptions | undefined,
    callback: (err: SystemError | null, stats: Stats | BigIntStats) => void
  ): void;
  // namespace lstat {
  //   /**
  //    * Asynchronous lstat(2) - Get file status. Does not dereference symbolic links.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions & {
  //       bigint?: false | undefined;
  //     }
  //   ): Promise<Stats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options: StatOptions & {
  //       bigint: true;
  //     }
  //   ): Promise<BigIntStats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions
  //   ): Promise<Stats | BigIntStats>;
  // }
  /**
   * Synchronous lstat(2) - Get file status. Does not dereference symbolic links.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  var lstatSync: StatSyncFn;
  /**
   * Creates a new link from the `existingPath` to the `newPath`. See the POSIX [`link(2)`](http://man7.org/linux/man-pages/man2/link.2.html) documentation for more detail. No arguments other than
   * a possible
   * exception are given to the completion callback.
   * @since v0.0.67
   */
  function link(
    existingPath: PathLike,
    newPath: PathLike,
    callback: NoParamCallback
  ): void;
  // namespace link {
  //   /**
  //    * Asynchronous link(2) - Create a new link (also known as a hard link) to an existing file.
  //    * @param existingPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param newPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     existingPath: PathLike,
  //     newPath: PathLike
  //   ): Promise<void>;
  // }
  /**
   * Creates a new link from the `existingPath` to the `newPath`. See the POSIX [`link(2)`](http://man7.org/linux/man-pages/man2/link.2.html) documentation for more detail. Returns `undefined`.
   * @since v0.0.67
   */
  function linkSync(existingPath: PathLike, newPath: PathLike): void;
  /**
   * Creates the link called `path` pointing to `target`. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * See the POSIX [`symlink(2)`](http://man7.org/linux/man-pages/man2/symlink.2.html) documentation for more details.
   *
   * The `type` argument is only available on Windows and ignored on other platforms.
   * It can be set to `'dir'`, `'file'`, or `'junction'`. If the `type` argument is
   * not set, Node.js will autodetect `target` type and use `'file'` or `'dir'`. If
   * the `target` does not exist, `'file'` will be used. Windows junction points
   * require the destination path to be absolute. When using `'junction'`, the`target` argument will automatically be normalized to absolute path.
   *
   * Relative targets are relative to the link’s parent directory.
   *
   * ```js
   * import { symlink } from 'fs';
   *
   * symlink('./mew', './example/mewtwo', callback);
   * ```
   *
   * The above example creates a symbolic link `mewtwo` in the `example` which points
   * to `mew` in the same directory:
   *
   * ```bash
   * $ tree example/
   * example/
   * ├── mew
   * └── mewtwo -> ./mew
   * ```
   * @since v0.0.67
   */
  function symlink(
    target: PathLike,
    path: PathLike,
    type: "symlink" | "junction" | undefined | null,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous symlink(2) - Create a new symbolic link to an existing file.
   * @param target A path to an existing file. If a URL is provided, it must use the `file:` protocol.
   * @param path A path to the new symlink. If a URL is provided, it must use the `file:` protocol.
   */
  function symlink(
    target: PathLike,
    path: PathLike,
    callback: NoParamCallback
  ): void;
  // namespace symlink {
  //   /**
  //    * Asynchronous symlink(2) - Create a new symbolic link to an existing file.
  //    * @param target A path to an existing file. If a URL is provided, it must use the `file:` protocol.
  //    * @param path A path to the new symlink. If a URL is provided, it must use the `file:` protocol.
  //    * @param type May be set to `'dir'`, `'file'`, or `'junction'` (default is `'file'`) and is only available on Windows (ignored on other platforms).
  //    * When using `'junction'`, the `target` argument will automatically be normalized to an absolute path.
  //    */
  //   function __promisify__(
  //     target: PathLike,
  //     path: PathLike,
  //     type?: string | null
  //   ): Promise<void>;
  //   type Type = "dir" | "file" | "junction";
  // }
  /**
   * Returns `undefined`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link symlink}.
   * @since v0.0.67
   */
  function symlinkSync(
    target: PathLike,
    path: PathLike,
    type?: "symlink" | "junction" | null
  ): void;
  /**
   * Reads the contents of the symbolic link referred to by `path`. The callback gets
   * two arguments `(err, linkString)`.
   *
   * See the POSIX [`readlink(2)`](http://man7.org/linux/man-pages/man2/readlink.2.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the link path passed to the callback. If the `encoding` is set to `'buffer'`,
   * the link path returned will be passed as a `Buffer` object.
   * @since v0.0.67
   */
  function readlink(
    path: PathLike,
    options: EncodingOption,
    callback: (err: SystemError | null, linkString: string) => void
  ): void;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function readlink(
    path: PathLike,
    options: BufferEncodingOption,
    callback: (err: SystemError | null, linkString: Buffer) => void
  ): void;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function readlink(
    path: PathLike,
    options: EncodingOption,
    // tslint:disable-next-line:unified-signatures
    callback: (err: SystemError | null, linkString: string | Buffer) => void
  ): void;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  // tslint:disable-next-line:unified-signatures
  function readlink(
    path: PathLike,
    callback: (err: SystemError | null, linkString: string) => void
  ): void;
  // namespace readlink {
  //   /**
  //    * Asynchronous readlink(2) - read value of a symbolic link.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string>;
  //   /**
  //    * Asynchronous readlink(2) - read value of a symbolic link.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: BufferEncodingOption
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronous readlink(2) - read value of a symbolic link.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string | Buffer>;
  // }
  /**
   * Returns the symbolic link's string value.
   *
   * See the POSIX [`readlink(2)`](http://man7.org/linux/man-pages/man2/readlink.2.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the link path returned. If the `encoding` is set to `'buffer'`,
   * the link path returned will be passed as a `Buffer` object.
   * @since v0.0.67
   */
  function readlinkSync(path: PathLike, options?: EncodingOption): string;
  /**
   * Synchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readlinkSync(path: PathLike, options: BufferEncodingOption): Buffer;
  /**
   * Synchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readlinkSync(
    path: PathLike,
    options?: EncodingOption
  ): string | Buffer;
  /**
   * Asynchronously computes the canonical pathname by resolving `.`, `..` and
   * symbolic links.
   *
   * A canonical pathname is not necessarily unique. Hard links and bind mounts can
   * expose a file system entity through many pathnames.
   *
   * This function behaves like [`realpath(3)`](http://man7.org/linux/man-pages/man3/realpath.3.html), with some exceptions:
   *
   * 1. No case conversion is performed on case-insensitive file systems.
   * 2. The maximum number of symbolic links is platform-independent and generally
   * (much) higher than what the native [`realpath(3)`](http://man7.org/linux/man-pages/man3/realpath.3.html) implementation supports.
   *
   * The `callback` gets two arguments `(err, resolvedPath)`. May use `process.cwd`to resolve relative paths.
   *
   * Only paths that can be converted to UTF8 strings are supported.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the path passed to the callback. If the `encoding` is set to `'buffer'`,
   * the path returned will be passed as a `Buffer` object.
   *
   * If `path` resolves to a socket or a pipe, the function will return a system
   * dependent name for that object.
   * @since v0.0.67
   */
  function realpath(
    path: PathLike,
    options: EncodingOption,
    callback: (err: SystemError | null, resolvedPath: string) => void
  ): void;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function realpath(
    path: PathLike,
    options: BufferEncodingOption,
    callback: (err: SystemError | null, resolvedPath: Buffer) => void
  ): void;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function realpath(
    path: PathLike,
    options: EncodingOption,
    // tslint:disable-next-line:unified-signatures
    callback: (err: SystemError | null, resolvedPath: string | Buffer) => void
  ): void;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  // tslint:disable-next-line:unified-signatures
  function realpath(
    path: PathLike,
    callback: (err: SystemError | null, resolvedPath: string) => void
  ): void;
  // namespace realpath {
  //   /**
  //    * Asynchronous realpath(3) - return the canonicalized absolute pathname.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string>;
  //   /**
  //    * Asynchronous realpath(3) - return the canonicalized absolute pathname.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: BufferEncodingOption
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronous realpath(3) - return the canonicalized absolute pathname.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string | Buffer>;
  //   /**
  //    * Asynchronous [`realpath(3)`](http://man7.org/linux/man-pages/man3/realpath.3.html).
  //    *
  //    * The `callback` gets two arguments `(err, resolvedPath)`.
  //    *
  //    * Only paths that can be converted to UTF8 strings are supported.
  //    *
  //    * The optional `options` argument can be a string specifying an encoding, or an
  //    * object with an `encoding` property specifying the character encoding to use for
  //    * the path passed to the callback. If the `encoding` is set to `'buffer'`,
  //    * the path returned will be passed as a `Buffer` object.
  //    *
  //    * On Linux, when Node.js is linked against musl libc, the procfs file system must
  //    * be mounted on `/proc` in order for this function to work. Glibc does not have
  //    * this restriction.
  //    * @since v0.0.67
  //    */
  //   function native(
  //     path: PathLike,
  //     options: EncodingOption,
  //     // tslint:disable-next-line:unified-signatures
  //     callback: (err: SystemError | null, resolvedPath: string) => void
  //   ): void;
  //   function native(
  //     path: PathLike,
  //     options: BufferEncodingOption,
  //     // tslint:disable-next-line:unified-signatures
  //     callback: (err: SystemError | null, resolvedPath: Buffer) => void
  //   ): void;
  //   function native(
  //     path: PathLike,
  //     options: EncodingOption,
  //     // tslint:disable-next-line:unified-signatures
  //     callback: (err: SystemError | null, resolvedPath: string | Buffer) => void
  //   ): void;
  //   function native(
  //     path: PathLike,
  //     callback: (err: SystemError | null, resolvedPath: string) => void
  //   ): void;
  // }
  /**
   * Returns the resolved pathname.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link realpath}.
   * @since v0.0.67
   */
  function realpathSync(path: PathLike, options?: EncodingOption): string;
  /**
   * Synchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function realpathSync(path: PathLike, options: BufferEncodingOption): Buffer;
  /**
   * Synchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function realpathSync(
    path: PathLike,
    options?: EncodingOption
  ): string | Buffer;
  namespace realpathSync {
    function native(path: PathLike, options?: EncodingOption): string;
    function native(path: PathLike, options: BufferEncodingOption): Buffer;
    function native(path: PathLike, options?: EncodingOption): string | Buffer;
  }
  /**
   * Asynchronously removes a file or symbolic link. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * ```js
   * import { unlink } from 'fs';
   * // Assuming that 'path/file.txt' is a regular file.
   * unlink('path/file.txt', (err) => {
   *   if (err) throw err;
   *   console.log('path/file.txt was deleted');
   * });
   * ```
   *
   * `fs.unlink()` will not work on a directory, empty or otherwise. To remove a
   * directory, use {@link rmdir}.
   *
   * See the POSIX [`unlink(2)`](http://man7.org/linux/man-pages/man2/unlink.2.html) documentation for more details.
   * @since v0.0.67
   */
  function unlink(path: PathLike, callback: NoParamCallback): void;
  // namespace unlink {
  //   /**
  //    * Asynchronous unlink(2) - delete a name and possibly the file it refers to.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(path: PathLike): Promise<void>;
  // }
  /**
   * Synchronous [`unlink(2)`](http://man7.org/linux/man-pages/man2/unlink.2.html). Returns `undefined`.
   * @since v0.0.67
   */
  function unlinkSync(path: PathLike): void;
  interface RmDirOptions {
    /**
     * If an `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, or
     * `EPERM` error is encountered, Node.js will retry the operation with a linear
     * backoff wait of `retryDelay` ms longer on each try. This option represents the
     * number of retries. This option is ignored if the `recursive` option is not
     * `true`.
     * @default 0
     */
    maxRetries?: number | undefined;
    /**
     * @deprecated since v14.14.0 In future versions of Node.js and will trigger a warning
     * `fs.rmdir(path, { recursive: true })` will throw if `path` does not exist or is a file.
     * Use `fs.rm(path, { recursive: true, force: true })` instead.
     *
     * If `true`, perform a recursive directory removal. In
     * recursive mode operations are retried on failure.
     * @default false
     */
    recursive?: boolean | undefined;
    /**
     * The amount of time in milliseconds to wait between retries.
     * This option is ignored if the `recursive` option is not `true`.
     * @default 100
     */
    retryDelay?: number | undefined;
  }
  /**
   * Asynchronous [`rmdir(2)`](http://man7.org/linux/man-pages/man2/rmdir.2.html). No arguments other than a possible exception are given
   * to the completion callback.
   *
   * Using `fs.rmdir()` on a file (not a directory) results in an `ENOENT` error on
   * Windows and an `ENOTDIR` error on POSIX.
   *
   * To get a behavior similar to the `rm -rf` Unix command, use {@link rm} with options `{ recursive: true, force: true }`.
   * @since v0.0.67
   */
  function rmdir(path: PathLike, callback: NoParamCallback): void;
  function rmdir(
    path: PathLike,
    options: RmDirOptions,
    callback: NoParamCallback
  ): void;
  // namespace rmdir {
  //   /**
  //    * Asynchronous rmdir(2) - delete a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: RmDirOptions
  //   ): Promise<void>;
  // }
  /**
   * Synchronous [`rmdir(2)`](http://man7.org/linux/man-pages/man2/rmdir.2.html). Returns `undefined`.
   *
   * Using `fs.rmdirSync()` on a file (not a directory) results in an `ENOENT` error
   * on Windows and an `ENOTDIR` error on POSIX.
   *
   * To get a behavior similar to the `rm -rf` Unix command, use {@link rmSync} with options `{ recursive: true, force: true }`.
   * @since v0.0.67
   */
  function rmdirSync(path: PathLike, options?: RmDirOptions): void;
  interface RmOptions {
    /**
     * When `true`, exceptions will be ignored if `path` does not exist.
     * @default false
     */
    force?: boolean | undefined;
    /**
     * If an `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, or
     * `EPERM` error is encountered, Node.js will retry the operation with a linear
     * backoff wait of `retryDelay` ms longer on each try. This option represents the
     * number of retries. This option is ignored if the `recursive` option is not
     * `true`.
     * @default 0
     */
    maxRetries?: number | undefined;
    /**
     * If `true`, perform a recursive directory removal. In
     * recursive mode, operations are retried on failure.
     * @default false
     */
    recursive?: boolean | undefined;
    /**
     * The amount of time in milliseconds to wait between retries.
     * This option is ignored if the `recursive` option is not `true`.
     * @default 100
     */
    retryDelay?: number | undefined;
  }
  interface MakeDirectoryOptions {
    /**
     * Indicates whether parent folders should be created.
     * If a folder was created, the path to the first created folder will be returned.
     * @default false
     */
    recursive?: boolean | undefined;
    /**
     * A file mode. If a string is passed, it is parsed as an octal integer. If not specified
     * @default 0o777
     */
    mode?: Mode | undefined;
  }
  /**
   * Asynchronously creates a directory.
   *
   * The callback is given a possible exception and, if `recursive` is `true`, the
   * first directory path created, `(err[, path])`.`path` can still be `undefined` when `recursive` is `true`, if no directory was
   * created.
   *
   * The optional `options` argument can be an integer specifying `mode` (permission
   * and sticky bits), or an object with a `mode` property and a `recursive`property indicating whether parent directories should be created. Calling`fs.mkdir()` when `path` is a directory that
   * exists results in an error only
   * when `recursive` is false.
   *
   * ```js
   * import { mkdir } from 'fs';
   *
   * // Creates /tmp/a/apple, regardless of whether `/tmp` and /tmp/a exist.
   * mkdir('/tmp/a/apple', { recursive: true }, (err) => {
   *   if (err) throw err;
   * });
   * ```
   *
   * On Windows, using `fs.mkdir()` on the root directory even with recursion will
   * result in an error:
   *
   * ```js
   * import { mkdir } from 'fs';
   *
   * mkdir('/', { recursive: true }, (err) => {
   *   // => [Error: EPERM: operation not permitted, mkdir 'C:\']
   * });
   * ```
   *
   * See the POSIX [`mkdir(2)`](http://man7.org/linux/man-pages/man2/mkdir.2.html) documentation for more details.
   * @since v0.0.67
   */
  function mkdir(
    path: PathLike,
    options: MakeDirectoryOptions & {
      recursive: true;
    },
    callback: (err: SystemError | null, path?: string) => void
  ): void;
  /**
   * Asynchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdir(
    path: PathLike,
    options:
      | Mode
      | (MakeDirectoryOptions & {
          recursive?: false | undefined;
        })
      | null
      | undefined,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdir(
    path: PathLike,
    // tslint:disable-next-line:unified-signatures
    options: Mode | MakeDirectoryOptions | null | undefined,
    callback: (err: SystemError | null, path?: string) => void
  ): void;
  /**
   * Asynchronous mkdir(2) - create a directory with a mode of `0o777`.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function mkdir(path: PathLike, callback: NoParamCallback): void;
  // namespace mkdir {
  //   /**
  //    * Asynchronous mkdir(2) - create a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
  //    * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: MakeDirectoryOptions & {
  //       recursive: true;
  //     }
  //   ): Promise<string | undefined>;
  //   /**
  //    * Asynchronous mkdir(2) - create a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
  //    * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?:
  //       | Mode
  //       | (MakeDirectoryOptions & {
  //           recursive?: false | undefined;
  //         })
  //       | null
  //   ): Promise<void>;
  //   /**
  //    * Asynchronous mkdir(2) - create a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
  //    * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: Mode | MakeDirectoryOptions | null
  //   ): Promise<string | undefined>;
  // }
  /**
   * Synchronously creates a directory. Returns `undefined`, or if `recursive` is`true`, the first directory path created.
   * This is the synchronous version of {@link mkdir}.
   *
   * See the POSIX [`mkdir(2)`](http://man7.org/linux/man-pages/man2/mkdir.2.html) documentation for more details.
   * @since v0.0.67
   */
  function mkdirSync(
    path: PathLike,
    options: MakeDirectoryOptions & {
      recursive: true;
    }
  ): string | undefined;
  /**
   * Synchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdirSync(
    path: PathLike,
    options?:
      | Mode
      | (MakeDirectoryOptions & {
          recursive?: false | undefined;
        })
      | null
  ): void;
  /**
   * Synchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdirSync(
    path: PathLike,
    options?: Mode | MakeDirectoryOptions | null
  ): string | undefined;
  /**
   * Creates a unique temporary directory.
   *
   * Generates six random characters to be appended behind a required`prefix` to create a unique temporary directory. Due to platform
   * inconsistencies, avoid trailing `X` characters in `prefix`. Some platforms,
   * notably the BSDs, can return more than six random characters, and replace
   * trailing `X` characters in `prefix` with random characters.
   *
   * The created directory path is passed as a string to the callback's second
   * parameter.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use.
   *
   * ```js
   * import { mkdtemp } from 'fs';
   *
   * mkdtemp(path.join(os.tmpdir(), 'foo-'), (err, directory) => {
   *   if (err) throw err;
   *   console.log(directory);
   *   // Prints: /tmp/foo-itXde2 or C:\Users\...\AppData\Local\Temp\foo-itXde2
   * });
   * ```
   *
   * The `fs.mkdtemp()` method will append the six randomly selected characters
   * directly to the `prefix` string. For instance, given a directory `/tmp`, if the
   * intention is to create a temporary directory _within_`/tmp`, the `prefix`must end with a trailing platform-specific path separator
   * (`require('path').sep`).
   *
   * ```js
   * import { tmpdir } from 'os';
   * import { mkdtemp } from 'fs';
   *
   * // The parent directory for the new temporary directory
   * const tmpDir = tmpdir();
   *
   * // This method is *INCORRECT*:
   * mkdtemp(tmpDir, (err, directory) => {
   *   if (err) throw err;
   *   console.log(directory);
   *   // Will print something similar to `/tmpabc123`.
   *   // A new temporary directory is created at the file system root
   *   // rather than *within* the /tmp directory.
   * });
   *
   * // This method is *CORRECT*:
   * import { sep } from 'path';
   * mkdtemp(`${tmpDir}${sep}`, (err, directory) => {
   *   if (err) throw err;
   *   console.log(directory);
   *   // Will print something similar to `/tmp/abc123`.
   *   // A new temporary directory is created within
   *   // the /tmp directory.
   * });
   * ```
   * @since v0.0.67
   */
  function mkdtemp(
    prefix: string,
    options: EncodingOption,
    callback: (err: SystemError | null, folder: string) => void
  ): void;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtemp(
    prefix: string,
    options:
      | "buffer"
      | {
          encoding: "buffer";
        },
    callback: (err: SystemError | null, folder: Buffer) => void
  ): void;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtemp(
    prefix: string,
    options: EncodingOption,
    // tslint:disable-next-line:unified-signatures
    callback: (err: SystemError | null, folder: string | Buffer) => void
  ): void;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   */
  // tslint:disable-next-line:unified-signatures
  function mkdtemp(
    prefix: string,
    callback: (err: SystemError | null, folder: string) => void
  ): void;
  // namespace mkdtemp {
  //   /**
  //    * Asynchronously creates a unique temporary directory.
  //    * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     prefix: string,
  //     options?: EncodingOption
  //   ): Promise<string>;
  //   /**
  //    * Asynchronously creates a unique temporary directory.
  //    * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     prefix: string,
  //     options: BufferEncodingOption
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronously creates a unique temporary directory.
  //    * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     prefix: string,
  //     options?: EncodingOption
  //   ): Promise<string | Buffer>;
  // }
  /**
   * Returns the created directory path.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link mkdtemp}.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use.
   * @since v0.0.67
   */
  function mkdtempSync(prefix: string, options?: EncodingOption): string;
  /**
   * Synchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtempSync(prefix: string, options: BufferEncodingOption): Buffer;
  /**
   * Synchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtempSync(
    prefix: string,
    options?: EncodingOption
  ): string | Buffer;
  /**
   * Reads the contents of a directory. The callback gets two arguments `(err, files)`where `files` is an array of the names of the files in the directory excluding`'.'` and `'..'`.
   *
   * See the POSIX [`readdir(3)`](http://man7.org/linux/man-pages/man3/readdir.3.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the filenames passed to the callback. If the `encoding` is set to `'buffer'`,
   * the filenames returned will be passed as `Buffer` objects.
   *
   * If `options.withFileTypes` is set to `true`, the `files` array will contain `fs.Dirent` objects.
   * @since v0.0.67
   */
  function readdir(
    path: PathLike,
    options:
      | {
          encoding: BufferEncoding | null;
          withFileTypes?: false | undefined;
        }
      | BufferEncoding
      | undefined
      | null,
    callback: (err: SystemError | null, files: string[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdir(
    path: PathLike,
    options:
      | {
          encoding: "buffer";
          withFileTypes?: false | undefined;
        }
      | "buffer",
    callback: (err: SystemError | null, files: Buffer[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdir(
    path: PathLike,
    options:
      | (ObjectEncodingOptions & {
          withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | undefined
      | null,
    callback: (err: SystemError | null, files: string[] | Buffer[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function readdir(
    path: PathLike,
    callback: (err: SystemError | null, files: string[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options If called with `withFileTypes: true` the result data will be an array of Dirent.
   */
  function readdir(
    path: PathLike,
    options: ObjectEncodingOptions & {
      withFileTypes: true;
    },
    callback: (err: SystemError | null, files: Dirent[]) => void
  ): void;
  // namespace readdir {
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?:
  //       | {
  //           encoding: BufferEncoding | null;
  //           withFileTypes?: false | undefined;
  //         }
  //       | BufferEncoding
  //       | null
  //   ): Promise<string[]>;
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options:
  //       | "buffer"
  //       | {
  //           encoding: "buffer";
  //           withFileTypes?: false | undefined;
  //         }
  //   ): Promise<Buffer[]>;
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?:
  //       | (ObjectEncodingOptions & {
  //           withFileTypes?: false | undefined;
  //         })
  //       | BufferEncoding
  //       | null
  //   ): Promise<string[] | Buffer[]>;
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options If called with `withFileTypes: true` the result data will be an array of Dirent
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: ObjectEncodingOptions & {
  //       withFileTypes: true;
  //     }
  //   ): Promise<Dirent[]>;
  // }
  /**
   * Reads the contents of the directory.
   *
   * See the POSIX [`readdir(3)`](http://man7.org/linux/man-pages/man3/readdir.3.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the filenames returned. If the `encoding` is set to `'buffer'`,
   * the filenames returned will be passed as `Buffer` objects.
   *
   * If `options.withFileTypes` is set to `true`, the result will contain `fs.Dirent` objects.
   * @since v0.0.67
   */
  function readdirSync(
    path: PathLike,
    options?:
      | {
          encoding: BufferEncoding | null;
          withFileTypes?: false | undefined;
        }
      | BufferEncoding
      | null
  ): string[];
  /**
   * Synchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdirSync(
    path: PathLike,
    options:
      | {
          encoding: "buffer";
          withFileTypes?: false | undefined;
        }
      | "buffer"
  ): Buffer[];
  /**
   * Synchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdirSync(
    path: PathLike,
    options?:
      | (ObjectEncodingOptions & {
          withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | null
  ): string[] | Buffer[];
  /**
   * Synchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options If called with `withFileTypes: true` the result data will be an array of Dirent.
   */
  function readdirSync(
    path: PathLike,
    options: ObjectEncodingOptions & {
      withFileTypes: true;
    }
  ): Dirent[];
  /**
   * Closes the file descriptor. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * Calling `fs.close()` on any file descriptor (`fd`) that is currently in use
   * through any other `fs` operation may lead to undefined behavior.
   *
   * See the POSIX [`close(2)`](http://man7.org/linux/man-pages/man2/close.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function close(fd: number, callback?: NoParamCallback): void;
  // namespace close {
  //   /**
  //    * Asynchronous close(2) - close a file descriptor.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number): Promise<void>;
  // }
  /**
   * Closes the file descriptor. Returns `undefined`.
   *
   * Calling `fs.closeSync()` on any file descriptor (`fd`) that is currently in use
   * through any other `fs` operation may lead to undefined behavior.
   *
   * See the POSIX [`close(2)`](http://man7.org/linux/man-pages/man2/close.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function closeSync(fd: number): void;
  /**
   * Asynchronous file open. See the POSIX [`open(2)`](http://man7.org/linux/man-pages/man2/open.2.html) documentation for more details.
   *
   * `mode` sets the file mode (permission and sticky bits), but only if the file was
   * created. On Windows, only the write permission can be manipulated; see {@link chmod}.
   *
   * The callback gets two arguments `(err, fd)`.
   *
   * Some characters (`< > : " / \ | ? *`) are reserved under Windows as documented
   * by [Naming Files, Paths, and Namespaces](https://docs.microsoft.com/en-us/windows/desktop/FileIO/naming-a-file). Under NTFS, if the filename contains
   * a colon, Node.js will open a file system stream, as described by [this MSDN page](https://docs.microsoft.com/en-us/windows/desktop/FileIO/using-streams).
   *
   * Functions based on `fs.open()` exhibit this behavior as well:`fs.writeFile()`, `fs.readFile()`, etc.
   * @since v0.0.67
   * @param [flags='r'] See `support of file system `flags``.
   * @param [mode=0o666]
   */
  function open(
    path: PathLike,
    flags: OpenMode,
    mode: Mode | undefined | null,
    callback: (err: SystemError | null, fd: number) => void
  ): void;
  /**
   * Asynchronous open(2) - open and possibly create a file. If the file is created, its mode will be `0o666`.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function open(
    path: PathLike,
    flags: OpenMode,
    callback: (err: SystemError | null, fd: number) => void
  ): void;
  // namespace open {
  //   /**
  //    * Asynchronous open(2) - open and possibly create a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer. If not supplied, defaults to `0o666`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     flags: OpenMode,
  //     mode?: Mode | null
  //   ): Promise<number>;
  // }
  /**
   * Returns an integer representing the file descriptor.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link open}.
   * @since v0.0.67
   * @param [flags='r']
   * @param [mode=0o666]
   */
  function openSync(
    path: PathLike,
    flags: OpenMode,
    mode?: Mode | null
  ): number;
  /**
   * Change the file system timestamps of the object referenced by `path`.
   *
   * The `atime` and `mtime` arguments follow these rules:
   *
   * * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
   * * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
   * @since v0.0.67
   */
  function utimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
    callback: NoParamCallback
  ): void;
  // namespace utimes {
  //   /**
  //    * Asynchronously change file timestamps of the file referenced by the supplied path.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param atime The last access time. If a string is provided, it will be coerced to number.
  //    * @param mtime The last modified time. If a string is provided, it will be coerced to number.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     atime: TimeLike,
  //     mtime: TimeLike
  //   ): Promise<void>;
  // }
  /**
   * Returns `undefined`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link utimes}.
   * @since v0.0.67
   */
  function utimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
  /**
   * Change the file system timestamps of the object referenced by the supplied file
   * descriptor. See {@link utimes}.
   * @since v0.0.67
   */
  function futimes(
    fd: number,
    atime: TimeLike,
    mtime: TimeLike,
    callback: NoParamCallback
  ): void;
  // namespace futimes {
  //   /**
  //    * Asynchronously change file timestamps of the file referenced by the supplied file descriptor.
  //    * @param fd A file descriptor.
  //    * @param atime The last access time. If a string is provided, it will be coerced to number.
  //    * @param mtime The last modified time. If a string is provided, it will be coerced to number.
  //    */
  //   function __promisify__(
  //     fd: number,
  //     atime: TimeLike,
  //     mtime: TimeLike
  //   ): Promise<void>;
  // }
  /**
   * Synchronous version of {@link futimes}. Returns `undefined`.
   * @since v0.0.67
   */
  function futimesSync(fd: number, atime: TimeLike, mtime: TimeLike): void;
  /**
   * Request that all data for the open file descriptor is flushed to the storage
   * device. The specific implementation is operating system and device specific.
   * Refer to the POSIX [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html) documentation for more detail. No arguments other
   * than a possible exception are given to the completion callback.
   * @since v0.0.67
   */
  function fsync(fd: number, callback: NoParamCallback): void;
  // namespace fsync {
  //   /**
  //    * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number): Promise<void>;
  // }
  /**
   * Request that all data for the open file descriptor is flushed to the storage
   * device. The specific implementation is operating system and device specific.
   * Refer to the POSIX [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html) documentation for more detail. Returns `undefined`.
   * @since v0.0.67
   */
  function fsyncSync(fd: number): void;
  /**
   * Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
   * must have an own `toString` function property.
   *
   * `offset` determines the part of the buffer to be written, and `length` is
   * an integer specifying the number of bytes to write.
   *
   * `position` refers to the offset from the beginning of the file where this data
   * should be written. If `typeof position !== 'number'`, the data will be written
   * at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
   *
   * The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a promise for an `Object` with `bytesWritten` and `buffer` properties.
   *
   * It is unsafe to use `fs.write()` multiple times on the same file without waiting
   * for the callback.
   *
   * On Linux, positional writes don't work when the file is opened in append mode.
   * The kernel ignores the position argument and always appends the data to
   * the end of the file.
   * @since v0.0.67
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    length: number | undefined | null,
    position: number | undefined | null,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
   * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    length: number | undefined | null,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param string A string to write.
   * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
   * @param encoding The expected string encoding.
   */
  function write(
    fd: number,
    string: string,
    position: number | undefined | null,
    encoding: BufferEncoding | undefined | null,
    callback: (err: SystemError | null, written: number, str: string) => void
  ): void;
  /**
   * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param string A string to write.
   * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
   */
  function write(
    fd: number,
    string: string,
    position: number | undefined | null,
    callback: (err: SystemError | null, written: number, str: string) => void
  ): void;
  /**
   * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param string A string to write.
   */
  function write(
    fd: number,
    string: string,
    callback: (err: SystemError | null, written: number, str: string) => void
  ): void;
  // namespace write {
  //   /**
  //    * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
  //    * @param fd A file descriptor.
  //    * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
  //    * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
  //    * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
  //    */
  //   function __promisify__<TBuffer extends ArrayBufferView>(
  //     fd: number,
  //     buffer?: TBuffer,
  //     offset?: number,
  //     length?: number,
  //     position?: number | null
  //   ): Promise<{
  //     bytesWritten: number;
  //     buffer: TBuffer;
  //   }>;
  //   /**
  //    * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
  //    * @param fd A file descriptor.
  //    * @param string A string to write.
  //    * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
  //    * @param encoding The expected string encoding.
  //    */
  //   function __promisify__(
  //     fd: number,
  //     string: string,
  //     position?: number | null,
  //     encoding?: BufferEncoding | null
  //   ): Promise<{
  //     bytesWritten: number;
  //     buffer: string;
  //   }>;
  // }
  /**
   * If `buffer` is a plain object, it must have an own (not inherited) `toString`function property.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link write}.
   * @since v0.0.67
   * @return The number of bytes written.
   */
  function writeSync(
    fd: number,
    buffer: ArrayBufferView,
    offset?: number | null,
    length?: number | null,
    position?: number | null
  ): number;
  /**
   * Synchronously writes `string` to the file referenced by the supplied file descriptor, returning the number of bytes written.
   * @param fd A file descriptor.
   * @param string A string to write.
   * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
   * @param encoding The expected string encoding.
   */
  function writeSync(
    fd: number,
    string: string,
    position?: number | null,
    encoding?: BufferEncoding | null
  ): number;
  type ReadPosition = number | bigint;
  interface ReadSyncOptions {
    /**
     * @default 0
     */
    offset?: number | undefined;
    /**
     * @default `length of buffer`
     */
    length?: number | undefined;
    /**
     * @default null
     */
    position?: ReadPosition | null | undefined;
  }
  interface ReadAsyncOptions<TBuffer extends ArrayBufferView>
    extends ReadSyncOptions {
    buffer?: TBuffer;
  }
  /**
   * Read data from the file specified by `fd`.
   *
   * The callback is given the three arguments, `(err, bytesRead, buffer)`.
   *
   * If the file is not modified concurrently, the end-of-file is reached when the
   * number of bytes read is zero.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a promise for an `Object` with `bytesRead` and `buffer` properties.
   * @since v0.0.67
   * @param buffer The buffer that the data will be written to.
   * @param offset The position in `buffer` to write the data to.
   * @param length The number of bytes to read.
   * @param position Specifies where to begin reading from in the file. If `position` is `null` or `-1 `, data will be read from the current file position, and the file position will be updated. If
   * `position` is an integer, the file position will be unchanged.
   */
  function read<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number,
    length: number,
    position: ReadPosition | null,
    callback: (
      err: SystemError | null,
      bytesRead: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Similar to the above `fs.read` function, this version takes an optional `options` object.
   * If not otherwise specified in an `options` object,
   * `buffer` defaults to `Buffer.alloc(16384)`,
   * `offset` defaults to `0`,
   * `length` defaults to `buffer.byteLength`, `- offset` as of Node 17.6.0
   * `position` defaults to `null`
   * @since v0.0.67
   */
  function read<TBuffer extends ArrayBufferView>(
    fd: number,
    options: ReadAsyncOptions<TBuffer>,
    callback: (
      err: SystemError | null,
      bytesRead: number,
      buffer: TBuffer
    ) => void
  ): void;
  function read(
    fd: number,
    callback: (
      err: SystemError | null,
      bytesRead: number,
      buffer: ArrayBufferView
    ) => void
  ): void;
  // namespace read {
  //   /**
  //    * @param fd A file descriptor.
  //    * @param buffer The buffer that the data will be written to.
  //    * @param offset The offset in the buffer at which to start writing.
  //    * @param length The number of bytes to read.
  //    * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
  //    */
  //   function __promisify__<TBuffer extends ArrayBufferView>(
  //     fd: number,
  //     buffer: TBuffer,
  //     offset: number,
  //     length: number,
  //     position: number | null
  //   ): Promise<{
  //     bytesRead: number;
  //     buffer: TBuffer;
  //   }>;
  //   function __promisify__<TBuffer extends ArrayBufferView>(
  //     fd: number,
  //     options: ReadAsyncOptions<TBuffer>
  //   ): Promise<{
  //     bytesRead: number;
  //     buffer: TBuffer;
  //   }>;
  //   function __promisify__(fd: number): Promise<{
  //     bytesRead: number;
  //     buffer: ArrayBufferView;
  //   }>;
  // }

  // TODO: Add AbortSignal support
  // tslint:disable-next-line:no-empty-interface
  interface Abortable {}

  /**
   * Returns the number of `bytesRead`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link read}.
   * @since v0.0.67
   */
  function readSync(
    fd: number,
    buffer: ArrayBufferView,
    offset: number,
    length: number,
    position: ReadPosition | null
  ): number;
  /**
   * Similar to the above `fs.readSync` function, this version takes an optional `options` object.
   * If no `options` object is specified, it will default with the above values.
   */
  function readSync(
    fd: number,
    buffer: ArrayBufferView,
    opts?: ReadSyncOptions
  ): number;
  /**
   * Asynchronously reads the entire contents of a file.
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * readFile('/etc/passwd', (err, data) => {
   *   if (err) throw err;
   *   console.log(data);
   * });
   * ```
   *
   * The callback is passed two arguments `(err, data)`, where `data` is the
   * contents of the file.
   *
   * If no encoding is specified, then the raw buffer is returned.
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * readFile('/etc/passwd', 'utf8', callback);
   * ```
   *
   * When the path is a directory, the behavior of `fs.readFile()` and {@link readFileSync} is platform-specific. On macOS, Linux, and Windows, an
   * error will be returned. On FreeBSD, a representation of the directory's contents
   * will be returned.
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * // macOS, Linux, and Windows
   * readFile('<directory>', (err, data) => {
   *   // => [Error: EISDIR: illegal operation on a directory, read <directory>]
   * });
   *
   * //  FreeBSD
   * readFile('<directory>', (err, data) => {
   *   // => null, <data>
   * });
   * ```
   *
   * It is possible to abort an ongoing request using an `AbortSignal`. If a
   * request is aborted the callback is called with an `AbortError`:
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * const controller = new AbortController();
   * const signal = controller.signal;
   * readFile(fileInfo[0].name, { signal }, (err, buf) => {
   *   // ...
   * });
   * // When you want to abort the request
   * controller.abort();
   * ```
   *
   * The `fs.readFile()` function buffers the entire file. To minimize memory costs,
   * when possible prefer streaming via `fs.createReadStream()`.
   *
   * Aborting an ongoing request does not abort individual operating
   * system requests but rather the internal buffering `fs.readFile` performs.
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | ({
          encoding?: null | undefined;
          flag?: string | undefined;
        } & Abortable)
      | undefined
      | null,
    callback: (err: SystemError | null, data: Buffer) => void
  ): void;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | ({
          encoding: BufferEncoding;
          flag?: string | undefined;
        } & Abortable)
      | BufferEncoding,
    callback: (err: SystemError | null, data: string) => void
  ): void;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | (ObjectEncodingOptions & {
          flag?: string | undefined;
        } & Abortable)
      | BufferEncoding
      | undefined
      | null,
    callback: (err: SystemError | null, data: string | Buffer) => void
  ): void;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   */
  function readFile(
    path: PathOrFileDescriptor,
    callback: (err: SystemError | null, data: Buffer) => void
  ): void;
  // namespace readFile {
  //   /**
  //    * Asynchronously reads the entire contents of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param options An object that may contain an optional flag.
  //    * If a flag is not provided, it defaults to `'r'`.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     options?: {
  //       encoding?: null | undefined;
  //       flag?: string | undefined;
  //     } | null
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronously reads the entire contents of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
  //    * If a flag is not provided, it defaults to `'r'`.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     options:
  //       | {
  //           encoding: BufferEncoding;
  //           flag?: string | undefined;
  //         }
  //       | BufferEncoding
  //   ): Promise<string>;
  //   /**
  //    * Asynchronously reads the entire contents of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
  //    * If a flag is not provided, it defaults to `'r'`.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     options?:
  //       | (ObjectEncodingOptions & {
  //           flag?: string | undefined;
  //         })
  //       | BufferEncoding
  //       | null
  //   ): Promise<string | Buffer>;
  // }
  /**
   * Returns the contents of the `path`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link readFile}.
   *
   * If the `encoding` option is specified then this function returns a
   * string. Otherwise it returns a buffer.
   *
   * Similar to {@link readFile}, when the path is a directory, the behavior of`fs.readFileSync()` is platform-specific.
   *
   * ```js
   * import { readFileSync } from 'fs';
   *
   * // macOS, Linux, and Windows
   * readFileSync('<directory>');
   * // => [Error: EISDIR: illegal operation on a directory, read <directory>]
   *
   * //  FreeBSD
   * readFileSync('<directory>'); // => <data>
   * ```
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function readFileSync(
    path: PathOrFileDescriptor,
    options?: {
      encoding?: null | undefined;
      flag?: string | undefined;
    } | null
  ): Buffer;
  /**
   * Synchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFileSync(
    path: PathOrFileDescriptor,
    options:
      | {
          encoding: BufferEncoding;
          flag?: string | undefined;
        }
      | BufferEncoding
  ): string;
  /**
   * Synchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFileSync(
    path: PathOrFileDescriptor,
    options?:
      | (ObjectEncodingOptions & {
          flag?: string | undefined;
        })
      | BufferEncoding
      | null
  ): string | Buffer;
  type WriteFileOptions =
    | (ObjectEncodingOptions &
        Abortable & {
          mode?: Mode | undefined;
          flag?: string | undefined;
        })
    | BufferEncoding
    | null;
  /**
   * When `file` is a filename, asynchronously writes data to the file, replacing the
   * file if it already exists. `data` can be a string or a buffer.
   *
   * When `file` is a file descriptor, the behavior is similar to calling`fs.write()` directly (which is recommended). See the notes below on using
   * a file descriptor.
   *
   * The `encoding` option is ignored if `data` is a buffer.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * If `data` is a plain object, it must have an own (not inherited) `toString`function property.
   *
   * ```js
   * import { writeFile } from 'fs';
   * import { Buffer } from 'buffer';
   *
   * const data = new Uint8Array(Buffer.from('Hello Node.js'));
   * writeFile('message.txt', data, (err) => {
   *   if (err) throw err;
   *   console.log('The file has been saved!');
   * });
   * ```
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { writeFile } from 'fs';
   *
   * writeFile('message.txt', 'Hello Node.js', 'utf8', callback);
   * ```
   *
   * It is unsafe to use `fs.writeFile()` multiple times on the same file without
   * waiting for the callback.
   *
   * Similarly to `fs.readFile` \- `fs.writeFile` is a convenience method that
   * performs multiple `write` calls internally to write the buffer passed to it.
   *
   * It is possible to use an `AbortSignal` to cancel an `fs.writeFile()`.
   * Cancelation is "best effort", and some amount of data is likely still
   * to be written.
   *
   * ```js
   * import { writeFile } from 'fs';
   * import { Buffer } from 'buffer';
   *
   * const controller = new AbortController();
   * const { signal } = controller;
   * const data = new Uint8Array(Buffer.from('Hello Node.js'));
   * writeFile('message.txt', data, { signal }, (err) => {
   *   // When a request is aborted - the callback is called with an AbortError
   * });
   * // When the request should be aborted
   * controller.abort();
   * ```
   *
   * Aborting an ongoing request does not abort individual operating
   * system requests but rather the internal buffering `fs.writeFile` performs.
   * @since v0.0.67
   * @param file filename or file descriptor
   */
  function writeFile(
    file: PathOrFileDescriptor,
    data: string | ArrayBufferView,
    options: WriteFileOptions,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronously writes data to a file, replacing the file if it already exists.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
   */
  function writeFile(
    path: PathOrFileDescriptor,
    data: string | ArrayBufferView,
    callback: NoParamCallback
  ): void;
  // namespace writeFile {
  //   /**
  //    * Asynchronously writes data to a file, replacing the file if it already exists.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
  //    * @param options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
  //    * If `encoding` is not supplied, the default of `'utf8'` is used.
  //    * If `mode` is not supplied, the default of `0o666` is used.
  //    * If `mode` is a string, it is parsed as an octal integer.
  //    * If `flag` is not supplied, the default of `'w'` is used.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     data: string | ArrayBufferView,
  //     options?: WriteFileOptions
  //   ): Promise<void>;
  // }
  /**
   * Returns `undefined`.
   *
   * If `data` is a plain object, it must have an own (not inherited) `toString`function property.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link writeFile}.
   * @since v0.0.67
   * @param file filename or file descriptor
   */
  function writeFileSync(
    file: PathOrFileDescriptor,
    data: string | ArrayBufferView,
    options?: WriteFileOptions
  ): void;
  /**
   * Asynchronously append data to a file, creating the file if it does not yet
   * exist. `data` can be a string or a `Buffer`.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * ```js
   * import { appendFile } from 'fs';
   *
   * appendFile('message.txt', 'data to append', (err) => {
   *   if (err) throw err;
   *   console.log('The "data to append" was appended to file!');
   * });
   * ```
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { appendFile } from 'fs';
   *
   * appendFile('message.txt', 'data to append', 'utf8', callback);
   * ```
   *
   * The `path` may be specified as a numeric file descriptor that has been opened
   * for appending (using `fs.open()` or `fs.openSync()`). The file descriptor will
   * not be closed automatically.
   *
   * ```js
   * import { open, close, appendFile } from 'fs';
   *
   * function closeFd(fd) {
   *   close(fd, (err) => {
   *     if (err) throw err;
   *   });
   * }
   *
   * open('message.txt', 'a', (err, fd) => {
   *   if (err) throw err;
   *
   *   try {
   *     appendFile(fd, 'data to append', 'utf8', (err) => {
   *       closeFd(fd);
   *       if (err) throw err;
   *     });
   *   } catch (err) {
   *     closeFd(fd);
   *     throw err;
   *   }
   * });
   * ```
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function appendFile(
    path: PathOrFileDescriptor,
    data: string | Uint8Array,
    options: WriteFileOptions,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronously append data to a file, creating the file if it does not exist.
   * @param file A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
   */
  function appendFile(
    file: PathOrFileDescriptor,
    data: string | Uint8Array,
    callback: NoParamCallback
  ): void;
  // namespace appendFile {
  //   /**
  //    * Asynchronously append data to a file, creating the file if it does not exist.
  //    * @param file A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
  //    * @param options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
  //    * If `encoding` is not supplied, the default of `'utf8'` is used.
  //    * If `mode` is not supplied, the default of `0o666` is used.
  //    * If `mode` is a string, it is parsed as an octal integer.
  //    * If `flag` is not supplied, the default of `'a'` is used.
  //    */
  //   function __promisify__(
  //     file: PathOrFileDescriptor,
  //     data: string | Uint8Array,
  //     options?: WriteFileOptions
  //   ): Promise<void>;
  // }
  /**
   * Synchronously append data to a file, creating the file if it does not yet
   * exist. `data` can be a string or a `Buffer`.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * ```js
   * import { appendFileSync } from 'fs';
   *
   * try {
   *   appendFileSync('message.txt', 'data to append');
   *   console.log('The "data to append" was appended to file!');
   * } catch (err) {
   *   // Handle the error
   * }
   * ```
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { appendFileSync } from 'fs';
   *
   * appendFileSync('message.txt', 'data to append', 'utf8');
   * ```
   *
   * The `path` may be specified as a numeric file descriptor that has been opened
   * for appending (using `fs.open()` or `fs.openSync()`). The file descriptor will
   * not be closed automatically.
   *
   * ```js
   * import { openSync, closeSync, appendFileSync } from 'fs';
   *
   * let fd;
   *
   * try {
   *   fd = openSync('message.txt', 'a');
   *   appendFileSync(fd, 'data to append', 'utf8');
   * } catch (err) {
   *   // Handle the error
   * } finally {
   *   if (fd !== undefined)
   *     closeSync(fd);
   * }
   * ```
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function appendFileSync(
    path: PathOrFileDescriptor,
    data: string | Uint8Array,
    options?: WriteFileOptions
  ): void;

  /**
   * Test whether or not the given path exists by checking with the file system.
   * Then call the `callback` argument with either true or false:
   *
   * ```js
   * import { exists } from 'fs';
   *
   * exists('/etc/passwd', (e) => {
   *   console.log(e ? 'it exists' : 'no passwd!');
   * });
   * ```
   *
   * **The parameters for this callback are not consistent with other Node.js**
   * **callbacks.** Normally, the first parameter to a Node.js callback is an `err`parameter, optionally followed by other parameters. The `fs.exists()` callback
   * has only one boolean parameter. This is one reason `fs.access()` is recommended
   * instead of `fs.exists()`.
   *
   * Using `fs.exists()` to check for the existence of a file before calling`fs.open()`, `fs.readFile()` or `fs.writeFile()` is not recommended. Doing
   * so introduces a race condition, since other processes may change the file's
   * state between the two calls. Instead, user code should open/read/write the
   * file directly and handle the error raised if the file does not exist.
   *
   * **write (NOT RECOMMENDED)**
   *
   * ```js
   * import { exists, open, close } from 'fs';
   *
   * exists('myfile', (e) => {
   *   if (e) {
   *     console.error('myfile already exists');
   *   } else {
   *     open('myfile', 'wx', (err, fd) => {
   *       if (err) throw err;
   *
   *       try {
   *         writeMyData(fd);
   *       } finally {
   *         close(fd, (err) => {
   *           if (err) throw err;
   *         });
   *       }
   *     });
   *   }
   * });
   * ```
   *
   * **write (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   * open('myfile', 'wx', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'EEXIST') {
   *       console.error('myfile already exists');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     writeMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * **read (NOT RECOMMENDED)**
   *
   * ```js
   * import { open, close, exists } from 'fs';
   *
   * exists('myfile', (e) => {
   *   if (e) {
   *     open('myfile', 'r', (err, fd) => {
   *       if (err) throw err;
   *
   *       try {
   *         readMyData(fd);
   *       } finally {
   *         close(fd, (err) => {
   *           if (err) throw err;
   *         });
   *       }
   *     });
   *   } else {
   *     console.error('myfile does not exist');
   *   }
   * });
   * ```
   *
   * **read (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   *
   * open('myfile', 'r', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'ENOENT') {
   *       console.error('myfile does not exist');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     readMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * The "not recommended" examples above check for existence and then use the
   * file; the "recommended" examples are better because they use the file directly
   * and handle the error, if any.
   *
   * In general, check for the existence of a file only if the file won’t be
   * used directly, for example when its existence is a signal from another
   * process.
   * @since v0.0.67
   */
  function exists(path: PathLike, callback: (exists: boolean) => void): void;
  /**
   * Returns `true` if the path exists, `false` otherwise.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link exists}.
   *
   * `fs.exists()` is deprecated, but `fs.existsSync()` is not. The `callback`parameter to `fs.exists()` accepts parameters that are inconsistent with other
   * Node.js callbacks. `fs.existsSync()` does not use a callback.
   *
   * ```js
   * import { existsSync } from 'fs';
   *
   * if (existsSync('/etc/passwd'))
   *   console.log('The path exists.');
   * ```
   * @since v0.0.67
   */
  function existsSync(path: PathLike): boolean;
  namespace constants {
    // File Access Constants
    /** Constant for fs.access(). File is visible to the calling process. */
    var F_OK: number;
    /** Constant for fs.access(). File can be read by the calling process. */
    var R_OK: number;
    /** Constant for fs.access(). File can be written by the calling process. */
    var W_OK: number;
    /** Constant for fs.access(). File can be executed by the calling process. */
    var X_OK: number;
    // File Copy Constants
    /** Constant for fs.copyFile. Flag indicating the destination file should not be overwritten if it already exists. */
    var COPYFILE_EXCL: number;
    /**
     * Constant for fs.copyFile. copy operation will attempt to create a copy-on-write reflink.
     * If the underlying platform does not support copy-on-write, then a fallback copy mechanism is used.
     */
    var COPYFILE_FICLONE: number;
    /**
     * Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
     * If the underlying platform does not support copy-on-write, then the operation will fail with an error.
     */
    var COPYFILE_FICLONE_FORCE: number;
    // File Open Constants
    /** Constant for fs.open(). Flag indicating to open a file for read-only access. */
    var O_RDONLY: number;
    /** Constant for fs.open(). Flag indicating to open a file for write-only access. */
    var O_WRONLY: number;
    /** Constant for fs.open(). Flag indicating to open a file for read-write access. */
    var O_RDWR: number;
    /** Constant for fs.open(). Flag indicating to create the file if it does not already exist. */
    var O_CREAT: number;
    /** Constant for fs.open(). Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists. */
    var O_EXCL: number;
    /**
     * Constant for fs.open(). Flag indicating that if path identifies a terminal device,
     * opening the path shall not cause that terminal to become the controlling terminal for the process
     * (if the process does not already have one).
     */
    var O_NOCTTY: number;
    /** Constant for fs.open(). Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero. */
    var O_TRUNC: number;
    /** Constant for fs.open(). Flag indicating that data will be appended to the end of the file. */
    var O_APPEND: number;
    /** Constant for fs.open(). Flag indicating that the open should fail if the path is not a directory. */
    var O_DIRECTORY: number;
    /**
     * constant for fs.open().
     * Flag indicating reading accesses to the file system will no longer result in
     * an update to the atime information associated with the file.
     * This flag is available on Linux operating systems only.
     */
    var O_NOATIME: number;
    /** Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link. */
    var O_NOFOLLOW: number;
    /** Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O. */
    var O_SYNC: number;
    /** Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity. */
    var O_DSYNC: number;
    /** Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to. */
    var O_SYMLINK: number;
    /** Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O. */
    var O_DIRECT: number;
    /** Constant for fs.open(). Flag indicating to open the file in nonblocking mode when possible. */
    var O_NONBLOCK: number;
    // File Type Constants
    /** Constant for fs.Stats mode property for determining a file's type. Bit mask used to extract the file type code. */
    var S_IFMT: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a regular file. */
    var S_IFREG: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a directory. */
    var S_IFDIR: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a character-oriented device file. */
    var S_IFCHR: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a block-oriented device file. */
    var S_IFBLK: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a FIFO/pipe. */
    var S_IFIFO: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a symbolic link. */
    var S_IFLNK: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a socket. */
    var S_IFSOCK: number;
    // File Mode Constants
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by owner. */
    var S_IRWXU: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by owner. */
    var S_IRUSR: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by owner. */
    var S_IWUSR: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner. */
    var S_IXUSR: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group. */
    var S_IRWXG: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group. */
    var S_IRGRP: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by group. */
    var S_IWGRP: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group. */
    var S_IXGRP: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others. */
    var S_IRWXO: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others. */
    var S_IROTH: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by others. */
    var S_IWOTH: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others. */
    var S_IXOTH: number;
    /**
     * When set, a memory file mapping is used to access the file. This flag
     * is available on Windows operating systems only. On other operating systems,
     * this flag is ignored.
     */
    var UV_FS_O_FILEMAP: number;
  }
  /**
   * Tests a user's permissions for the file or directory specified by `path`.
   * The `mode` argument is an optional integer that specifies the accessibility
   * checks to be performed. Check `File access constants` for possible values
   * of `mode`. It is possible to create a mask consisting of the bitwise OR of
   * two or more values (e.g. `fs.constants.W_OK | fs.constants.R_OK`).
   *
   * The final argument, `callback`, is a callback function that is invoked with
   * a possible error argument. If any of the accessibility checks fail, the error
   * argument will be an `Error` object. The following examples check if`package.json` exists, and if it is readable or writable.
   *
   * ```js
   * import { access, constants } from 'fs';
   *
   * const file = 'package.json';
   *
   * // Check if the file exists in the current directory.
   * access(file, constants.F_OK, (err) => {
   *   console.log(`${file} ${err ? 'does not exist' : 'exists'}`);
   * });
   *
   * // Check if the file is readable.
   * access(file, constants.R_OK, (err) => {
   *   console.log(`${file} ${err ? 'is not readable' : 'is readable'}`);
   * });
   *
   * // Check if the file is writable.
   * access(file, constants.W_OK, (err) => {
   *   console.log(`${file} ${err ? 'is not writable' : 'is writable'}`);
   * });
   *
   * // Check if the file exists in the current directory, and if it is writable.
   * access(file, constants.F_OK | constants.W_OK, (err) => {
   *   if (err) {
   *     console.error(
   *       `${file} ${err.code === 'ENOENT' ? 'does not exist' : 'is read-only'}`);
   *   } else {
   *     console.log(`${file} exists, and it is writable`);
   *   }
   * });
   * ```
   *
   * Do not use `fs.access()` to check for the accessibility of a file before calling`fs.open()`, `fs.readFile()` or `fs.writeFile()`. Doing
   * so introduces a race condition, since other processes may change the file's
   * state between the two calls. Instead, user code should open/read/write the
   * file directly and handle the error raised if the file is not accessible.
   *
   * **write (NOT RECOMMENDED)**
   *
   * ```js
   * import { access, open, close } from 'fs';
   *
   * access('myfile', (err) => {
   *   if (!err) {
   *     console.error('myfile already exists');
   *     return;
   *   }
   *
   *   open('myfile', 'wx', (err, fd) => {
   *     if (err) throw err;
   *
   *     try {
   *       writeMyData(fd);
   *     } finally {
   *       close(fd, (err) => {
   *         if (err) throw err;
   *       });
   *     }
   *   });
   * });
   * ```
   *
   * **write (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   *
   * open('myfile', 'wx', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'EEXIST') {
   *       console.error('myfile already exists');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     writeMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * **read (NOT RECOMMENDED)**
   *
   * ```js
   * import { access, open, close } from 'fs';
   * access('myfile', (err) => {
   *   if (err) {
   *     if (err.code === 'ENOENT') {
   *       console.error('myfile does not exist');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   open('myfile', 'r', (err, fd) => {
   *     if (err) throw err;
   *
   *     try {
   *       readMyData(fd);
   *     } finally {
   *       close(fd, (err) => {
   *         if (err) throw err;
   *       });
   *     }
   *   });
   * });
   * ```
   *
   * **read (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   *
   * open('myfile', 'r', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'ENOENT') {
   *       console.error('myfile does not exist');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     readMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * The "not recommended" examples above check for accessibility and then use the
   * file; the "recommended" examples are better because they use the file directly
   * and handle the error, if any.
   *
   * In general, check for the accessibility of a file only if the file will not be
   * used directly, for example when its accessibility is a signal from another
   * process.
   *
   * On Windows, access-control policies (ACLs) on a directory may limit access to
   * a file or directory. The `fs.access()` function, however, does not check the
   * ACL and therefore may report that a path is accessible even if the ACL restricts
   * the user from reading or writing to it.
   * @since v0.0.67
   * @param [mode=fs.constants.F_OK]
   */
  function access(
    path: PathLike,
    mode: number | undefined,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronously tests a user's permissions for the file specified by path.
   * @param path A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
   */
  function access(path: PathLike, callback: NoParamCallback): void;
  // namespace access {
  //   /**
  //    * Asynchronously tests a user's permissions for the file specified by path.
  //    * @param path A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    */
  //   function __promisify__(path: PathLike, mode?: number): Promise<void>;
  // }
  /**
   * Synchronously tests a user's permissions for the file or directory specified
   * by `path`. The `mode` argument is an optional integer that specifies the
   * accessibility checks to be performed. Check `File access constants` for
   * possible values of `mode`. It is possible to create a mask consisting of
   * the bitwise OR of two or more values
   * (e.g. `fs.constants.W_OK | fs.constants.R_OK`).
   *
   * If any of the accessibility checks fail, an `Error` will be thrown. Otherwise,
   * the method will return `undefined`.
   *
   * ```js
   * import { accessSync, constants } from 'fs';
   *
   * try {
   *   accessSync('etc/passwd', constants.R_OK | constants.W_OK);
   *   console.log('can read/write');
   * } catch (err) {
   *   console.error('no access!');
   * }
   * ```
   * @since v0.0.67
   * @param [mode=fs.constants.F_OK]
   */
  function accessSync(path: PathLike, mode?: number): void;

  /**
   * Forces all currently queued I/O operations associated with the file to the
   * operating system's synchronized I/O completion state. Refer to the POSIX [`fdatasync(2)`](http://man7.org/linux/man-pages/man2/fdatasync.2.html) documentation for details. No arguments other
   * than a possible
   * exception are given to the completion callback.
   * @since v0.0.67
   */
  function fdatasync(fd: number, callback: NoParamCallback): void;
  // namespace fdatasync {
  //   /**
  //    * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number): Promise<void>;
  // }
  /**
   * Forces all currently queued I/O operations associated with the file to the
   * operating system's synchronized I/O completion state. Refer to the POSIX [`fdatasync(2)`](http://man7.org/linux/man-pages/man2/fdatasync.2.html) documentation for details. Returns `undefined`.
   * @since v0.0.67
   */
  function fdatasyncSync(fd: number): void;
  /**
   * Asynchronously copies `src` to `dest`. By default, `dest` is overwritten if it
   * already exists. No arguments other than a possible exception are given to the
   * callback function. Node.js makes no guarantees about the atomicity of the copy
   * operation. If an error occurs after the destination file has been opened for
   * writing, Node.js will attempt to remove the destination.
   *
   * `mode` is an optional integer that specifies the behavior
   * of the copy operation. It is possible to create a mask consisting of the bitwise
   * OR of two or more values (e.g.`fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE`).
   *
   * * `fs.constants.COPYFILE_EXCL`: The copy operation will fail if `dest` already
   * exists.
   * * `fs.constants.COPYFILE_FICLONE`: The copy operation will attempt to create a
   * copy-on-write reflink. If the platform does not support copy-on-write, then a
   * fallback copy mechanism is used.
   * * `fs.constants.COPYFILE_FICLONE_FORCE`: The copy operation will attempt to
   * create a copy-on-write reflink. If the platform does not support
   * copy-on-write, then the operation will fail.
   *
   * ```js
   * import { copyFile, constants } from 'fs';
   *
   * function callback(err) {
   *   if (err) throw err;
   *   console.log('source.txt was copied to destination.txt');
   * }
   *
   * // destination.txt will be created or overwritten by default.
   * copyFile('source.txt', 'destination.txt', callback);
   *
   * // By using COPYFILE_EXCL, the operation will fail if destination.txt exists.
   * copyFile('source.txt', 'destination.txt', constants.COPYFILE_EXCL, callback);
   * ```
   * @since v0.0.67
   * @param src source filename to copy
   * @param dest destination filename of the copy operation
   * @param [mode=0] modifiers for copy operation.
   */
  function copyFile(
    src: PathLike,
    dest: PathLike,
    callback: NoParamCallback
  ): void;
  function copyFile(
    src: PathLike,
    dest: PathLike,
    mode: number,
    callback: NoParamCallback
  ): void;
  // namespace copyFile {
  //   function __promisify__(
  //     src: PathLike,
  //     dst: PathLike,
  //     mode?: number
  //   ): Promise<void>;
  // }
  /**
   * Synchronously copies `src` to `dest`. By default, `dest` is overwritten if it
   * already exists. Returns `undefined`. Node.js makes no guarantees about the
   * atomicity of the copy operation. If an error occurs after the destination file
   * has been opened for writing, Node.js will attempt to remove the destination.
   *
   * `mode` is an optional integer that specifies the behavior
   * of the copy operation. It is possible to create a mask consisting of the bitwise
   * OR of two or more values (e.g.`fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE`).
   *
   * * `fs.constants.COPYFILE_EXCL`: The copy operation will fail if `dest` already
   * exists.
   * * `fs.constants.COPYFILE_FICLONE`: The copy operation will attempt to create a
   * copy-on-write reflink. If the platform does not support copy-on-write, then a
   * fallback copy mechanism is used.
   * * `fs.constants.COPYFILE_FICLONE_FORCE`: The copy operation will attempt to
   * create a copy-on-write reflink. If the platform does not support
   * copy-on-write, then the operation will fail.
   *
   * ```js
   * import { copyFileSync, constants } from 'fs';
   *
   * // destination.txt will be created or overwritten by default.
   * copyFileSync('source.txt', 'destination.txt');
   * console.log('source.txt was copied to destination.txt');
   *
   * // By using COPYFILE_EXCL, the operation will fail if destination.txt exists.
   * copyFileSync('source.txt', 'destination.txt', constants.COPYFILE_EXCL);
   * ```
   * @since v0.0.67
   * @param src source filename to copy
   * @param dest destination filename of the copy operation
   * @param [mode=0] modifiers for copy operation.
   */
  function copyFileSync(src: PathLike, dest: PathLike, mode?: number): void;
  /**
   * Write an array of `ArrayBufferView`s to the file specified by `fd` using`writev()`.
   *
   * `position` is the offset from the beginning of the file where this data
   * should be written. If `typeof position !== 'number'`, the data will be written
   * at the current position.
   *
   * The callback will be given three arguments: `err`, `bytesWritten`, and`buffers`. `bytesWritten` is how many bytes were written from `buffers`.
   *
   * If this method is `util.promisify()` ed, it returns a promise for an`Object` with `bytesWritten` and `buffers` properties.
   *
   *
   * On Linux, positional writes don't work when the file is opened in append mode.
   * The kernel ignores the position argument and always appends the data to
   * the end of the file.
   * @since v0.0.67
   */
  function writev(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    cb: (
      err: SystemError | null,
      bytesWritten: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  function writev(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position: number,
    cb: (
      err: SystemError | null,
      bytesWritten: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  interface WriteVResult {
    bytesWritten: number;
    buffers: ArrayBufferView[];
  }
  // namespace writev {
  //   function __promisify__(
  //     fd: number,
  //     buffers: ReadonlyArray<ArrayBufferView>,
  //     position?: number
  //   ): Promise<WriteVResult>;
  // }
  /**
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link writev}.
   * @since v0.0.67
   * @return The number of bytes written.
   */
  function writevSync(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position?: number
  ): number;
  /**
   * Read from a file specified by `fd` and write to an array of `ArrayBufferView`s
   * using `readv()`.
   *
   * `position` is the offset from the beginning of the file from where data
   * should be read. If `typeof position !== 'number'`, the data will be read
   * from the current position.
   *
   * The callback will be given three arguments: `err`, `bytesRead`, and`buffers`. `bytesRead` is how many bytes were read from the file.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a promise for an `Object` with `bytesRead` and `buffers` properties.
   * @since v0.0.67
   */
  function readv(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    cb: (
      err: SystemError | null,
      bytesRead: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  function readv(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position: number,
    cb: (
      err: SystemError | null,
      bytesRead: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  interface ReadVResult {
    bytesRead: number;
    buffers: ArrayBufferView[];
  }
  // namespace readv {
  //   function __promisify__(
  //     fd: number,
  //     buffers: ReadonlyArray<ArrayBufferView>,
  //     position?: number
  //   ): Promise<ReadVResult>;
  // }
  /**
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link readv}.
   * @since v0.0.67
   * @return The number of bytes read.
   */
  function readvSync(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position?: number
  ): number;
  interface OpenDirOptions {
    encoding?: BufferEncoding | undefined;
    /**
     * Number of directory entries that are buffered
     * internally when reading from the directory. Higher values lead to better
     * performance but higher memory usage.
     * @default 32
     */
    bufferSize?: number | undefined;
  }

  interface BigIntStats extends StatsBase<bigint> {
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
  }
  interface BigIntOptions {
    bigint: true;
  }
  interface StatOptions {
    bigint?: boolean | undefined;
  }
  interface StatSyncOptions extends StatOptions {
    throwIfNoEntry?: boolean | undefined;
  }
  interface CopyOptions {
    /**
     * Dereference symlinks
     * @default false
     */
    dereference?: boolean;
    /**
     * When `force` is `false`, and the destination
     * exists, throw an error.
     * @default false
     */
    errorOnExist?: boolean;
    /**
     * function to filter copied files/directories. Return
     * `true` to copy the item, `false` to ignore it.
     */
    filter?(source: string, destination: string): boolean;
    /**
     * Overwrite existing file or directory. _The copy
     * operation will ignore errors if you set this to false and the destination
     * exists. Use the `errorOnExist` option to change this behavior.
     * @default true
     */
    force?: boolean;
    /**
     * When `true` timestamps from `src` will
     * be preserved.
     * @default false
     */
    preserveTimestamps?: boolean;
    /**
     * Copy directories recursively.
     * @default false
     */
    recursive?: boolean;
  }
}

declare module "node:fs" {
  import * as fs from "fs";
  export = fs;
}


// ./html-rewriter.d.ts

declare namespace HTMLRewriterTypes {
  interface HTMLRewriterElementContentHandlers {
    element?(element: Element): void | Promise<void>;
    comments?(comment: Comment): void | Promise<void>;
    text?(text: Text): void | Promise<void>;
  }

  interface HTMLRewriterDocumentContentHandlers {
    doctype?(doctype: Doctype): void | Promise<void>;
    comments?(comment: Comment): void | Promise<void>;
    text?(text: Text): void | Promise<void>;
    end?(end: DocumentEnd): void | Promise<void>;
  }

  interface Text {
    readonly text: string;
    readonly lastInTextNode: boolean;
    readonly removed: boolean;
    before(content: Content, options?: ContentOptions): Text;
    after(content: Content, options?: ContentOptions): Text;
    replace(content: Content, options?: ContentOptions): Text;
    remove(): Text;
  }

  interface Doctype {
    readonly name: string | null;
    readonly publicId: string | null;
    readonly systemId: string | null;
  }

  interface DocumentEnd {
    append(content: Content, options?: ContentOptions): DocumentEnd;
  }

  interface ContentOptions {
    html?: boolean;
  }
  type Content = string;

  interface Comment {
    text: string;
    readonly removed: boolean;
    before(content: Content, options?: ContentOptions): Comment;
    after(content: Content, options?: ContentOptions): Comment;
    replace(content: Content, options?: ContentOptions): Comment;
    remove(): Comment;
  }

  interface Element {
    tagName: string;
    readonly attributes: IterableIterator<string[]>;
    readonly removed: boolean;
    readonly namespaceURI: string;
    getAttribute(name: string): string | null;
    hasAttribute(name: string): boolean;
    setAttribute(name: string, value: string): Element;
    removeAttribute(name: string): Element;
    before(content: Content, options?: ContentOptions): Element;
    after(content: Content, options?: ContentOptions): Element;
    prepend(content: Content, options?: ContentOptions): Element;
    append(content: Content, options?: ContentOptions): Element;
    replace(content: Content, options?: ContentOptions): Element;
    remove(): Element;
    removeAndKeepContent(): Element;
    setInnerContent(content: Content, options?: ContentOptions): Element;
    onEndTag(handler: (tag: EndTag) => void | Promise<void>): void;
  }

  interface EndTag {
    name: string;
    before(content: Content, options?: ContentOptions): EndTag;
    after(content: Content, options?: ContentOptions): EndTag;
    remove(): EndTag;
  }
}

/**
 * [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter?bun) is a fast API for transforming HTML.
 *
 * Bun leverages a native implementation powered by [lol-html](https://github.com/cloudflare/lol-html).
 *
 * HTMLRewriter can be used to transform HTML in a variety of ways, including:
 * * Rewriting URLs
 * * Adding meta tags
 * * Removing elements
 * * Adding elements to the head
 *
 * @example
 * ```ts
 * const rewriter = new HTMLRewriter().on('a[href]', {
 *   element(element: Element) {
 *     // Rewrite all the URLs to this youtube video
 *     element.setAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 *   }
 * });
 * rewriter.transform(await fetch("https://remix.run"));
 * ```
 */
declare class HTMLRewriter {
  constructor();
  on(
    selector: string,
    handlers: HTMLRewriterTypes.HTMLRewriterElementContentHandlers
  ): HTMLRewriter;
  onDocument(
    handlers: HTMLRewriterTypes.HTMLRewriterDocumentContentHandlers
  ): HTMLRewriter;
  /**
   * @param input - The HTML to transform
   * @returns A new {@link Response} with the transformed HTML
   */
  transform(input: Response): Response;
}


// ./globals.d.ts

type Encoding = "utf-8" | "windows-1252" | "utf-16";
type Platform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';
type Architecture = 'arm' | 'arm64' | 'ia32' | 'mips' | 'mipsel' | 'ppc' | 'ppc64' | 's390' | 's390x' | 'x64';
type Signals =
    | 'SIGABRT'
    | 'SIGALRM'
    | 'SIGBUS'
    | 'SIGCHLD'
    | 'SIGCONT'
    | 'SIGFPE'
    | 'SIGHUP'
    | 'SIGILL'
    | 'SIGINT'
    | 'SIGIO'
    | 'SIGIOT'
    | 'SIGKILL'
    | 'SIGPIPE'
    | 'SIGPOLL'
    | 'SIGPROF'
    | 'SIGPWR'
    | 'SIGQUIT'
    | 'SIGSEGV'
    | 'SIGSTKFLT'
    | 'SIGSTOP'
    | 'SIGSYS'
    | 'SIGTERM'
    | 'SIGTRAP'
    | 'SIGTSTP'
    | 'SIGTTIN'
    | 'SIGTTOU'
    | 'SIGUNUSED'
    | 'SIGURG'
    | 'SIGUSR1'
    | 'SIGUSR2'
    | 'SIGVTALRM'
    | 'SIGWINCH'
    | 'SIGXCPU'
    | 'SIGXFSZ'
    | 'SIGBREAK'
    | 'SIGLOST'
    | 'SIGINFO';

interface console {
  assert(condition?: boolean, ...data: any[]): void;
  clear(): void;
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

declare var console: console;

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
  path: string;
  /**
   * Absolute path to the directory containing the source file.
   *
   * Does not have a trailing slash
   */
  dir: string;
  /**
   * Filename of the source file
   */
  file: string;
  /**
   * Resolve a module ID the same as if you imported it
   *
   * On failure, throws a `ResolveError`
   */
  resolve(moduleId: string): Promise<string>;
  /**
   * Resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveError`
   */
  // tslint:disable-next-line:unified-signatures
  resolve(moduleId: string, parent: string): Promise<string>;
}

/** @deprecated Please use `import.meta.path` instead. */
declare var __filename: string;

/** @deprecated Please use `import.meta.dir` instead. */
declare var __dirname: string;

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
   * The current version of Bun
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
  versions: Record<string, string>;
  ppid: number;
  pid: number;
  arch: Architecture;
  platform: Platform;
  argv: string[];
  // execArgv: string[];
  env: Record<string, string> & {
    NODE_ENV: string;
  };

  /** Whether you are using Bun */
  isBun: 1; // FIXME: this should actually return a boolean
  // execPath: string;
  // abort(): void;
  chdir(directory: string): void;
  cwd(): string;
  exit(code?: number): void;
  getgid(): number;
  setgid(id: number | string): void;
  getuid(): number;
  setuid(id: number | string): void;
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
  json<TJSONReturnType = unknown>(): Promise<TJSONReturnType>;
}

type BlobPart = string | Blob | ArrayBufferView | ArrayBuffer;
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
  forEach(
    callbackfn: (value: string, key: string, parent: Headers) => void,
    thisArg?: any
  ): void;
}

declare var Headers: {
  prototype: Headers;
  new (init?: HeadersInit): Headers;
};

type HeadersInit = Array<[string, string]> | Record<string, string> | Headers;
type ResponseType =
  | "basic"
  | "cors"
  | "default"
  | "error"
  | "opaque"
  | "opaqueredirect";

declare class Blob implements BlobInterface {
  /**
   * Create a new [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   *
   * @param `parts` - An array of strings, numbers, TypedArray, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
   * @param `options` - An object containing properties to be added to the [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   */
  constructor(parts?: BlobPart[] | Blob, options?: BlobPropertyBag);
  /**
   * Create a new view **without 🚫 copying** the underlying data.
   *
   * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray)
   *
   * @param begin The index that sets the beginning of the view.
   * @param end The index that sets the end of the view.
   *
   */
  slice(begin?: number, end?: number): Blob;

  /**
   * Read the data from the blob as a string. It will be decoded from UTF-8.
   */
  text(): Promise<string>;

  /**
   * Read the data from the blob as a ReadableStream.
   */
  stream(): ReadableStream<Uint8Array>;

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
  json<TJSONReturnType = unknown>(): Promise<TJSONReturnType>;

  type: string;
  size: number;
}

interface ResponseInit {
  headers?: HeadersInit;
  /** @default 200 */
  status?: number;

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
  constructor(body: BlobPart | BlobPart[], options?: ResponseInit);

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
  json<TJSONReturnType = unknown>(): Promise<TJSONReturnType>;

  /**
   * Read the data from the Response as a Blob.
   *
   * This allows you to reuse the underlying data.
   *
   * @returns Promise<Blob> - The body of the response as a {@link Blob}.
   */
  blob(): Promise<Blob>;

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
type RequestInfo = Request | string;

type BodyInit = ReadableStream | XMLHttpRequestBodyInit;
type XMLHttpRequestBodyInit = Blob | BufferSource | string;
type ReadableStreamController<T> = ReadableStreamDefaultController<T>;
type ReadableStreamDefaultReadResult<T> =
  | ReadableStreamDefaultReadValueResult<T>
  | ReadableStreamDefaultReadDoneResult;
type ReadableStreamReader<T> = ReadableStreamDefaultReader<T>;

interface RequestInit {
  /**
   * A BodyInit object or null to set request's body.
   */
  body?: BodyInit | null;
  /**
   * A string indicating how the request will interact with the browser's cache to set request's cache.
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
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
   * Note: as of Bun v0.0.74, this is not implemented yet.
   */
  integrity?: string;
  /**
   * A boolean to set request's keepalive.
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
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
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
   */
  signal?: AbortSignal | null;
  /**
   * Can only be null. Used to disassociate request from any Window.
   *
   * This does nothing in Bun
   */
  window?: any;
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
  constructor(requestInfo: RequestInfo, requestInit?: RequestInit);

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
  json<TJSONReturnType = unknown>(): Promise<TJSONReturnType>;

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
   *
   * Note: this is **not implemented yet**. The cake is a lie.
   */
  readonly signal: AbortSignal;

  /** Copy the Request object into a new Request, including the body */
  clone(): Request;
}

interface Crypto {
  getRandomValues<T extends TypedArray = TypedArray>(array: T): T;
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

declare var crypto: Crypto;

/**
 * [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob) converts ascii text into base64.
 *
 * @param asciiText The ascii text to convert.
 */
declare function atob(asciiText: string): string;

/**
 * [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/btoa) decodes base64 into ascii text.
 *
 * @param base64Text The base64 text to convert.
 */
declare function btoa(base64Text: string): string;

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
  encodeInto(src?: string, dest?: TypedArray): EncodeIntoResult;
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
    options?: { fatal?: boolean; ignoreBOM?: boolean }
  );

  /**
   * Decodes the `input` and returns a string. If `options.stream` is `true`, any
   * incomplete byte sequences occurring at the end of the `input` are buffered
   * internally and emitted after the next call to `textDecoder.decode()`.
   *
   * If `textDecoder.fatal` is `true`, decoding errors that occur will result in a`TypeError` being thrown.
   * @param input An `ArrayBuffer`, `DataView` or `TypedArray` instance containing the encoded data.
   */
  decode(input?: TypedArray | ArrayBuffer): string;
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

interface Blob {
  /**
   * Read the contents of the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as a JSON object
   * @warn in browsers, this function is only available for `Response` and `Request`
   */
  json(): Promise<any>;
  /**
   * Read the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as a UTF-8 string
   * @link https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
   */
  text(): Promise<string>;
  /**
   * Read the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as an ArrayBuffer object
   * @link https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare var performance: {
  /**
   * Seconds since Bun.js started
   *
   * Uses a high-precision system timer to measure the time elapsed since the
   * Bun.js runtime was initialized. The value is represented as a double
   * precision floating point number. The value is monotonically increasing
   * during the lifetime of the runtime.
   *
   */
  now: () => number;
};

/**
 * Cancel a repeating timer by its timer ID.
 * @param id timer id
 */
declare function clearInterval(id?: number): void;
/**
 * Cancel a delayed function call by its timer ID.
 * @param id timer id
 */
declare function clearTimeout(id?: number): void;
// declare function createImageBitmap(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
// declare function createImageBitmap(image: ImageBitmapSource, sx: number, sy: number, sw: number, sh: number, options?: ImageBitmapOptions): Promise<ImageBitmap>;
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
declare function fetch(url: string, init?: RequestInit): Promise<Response>;

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

declare function queueMicrotask(callback: () => void): void;
/**
 * Log an error using the default exception handler
 * @param error Error or string
 */
declare function reportError(error: any): void;
/**
 * Run a function every `interval` milliseconds
 * @param handler function to call
 * @param interval milliseconds to wait between calls
 */
declare function setInterval(
  handler: TimerHandler,
  interval?: number,
  ...arguments: any[]
): number;
/**
 * Run a function after `timeout` (milliseconds)
 * @param handler function to call
 * @param timeout milliseconds to wait between calls
 */
declare function setTimeout(
  handler: TimerHandler,
  timeout?: number,
  ...arguments: any[]
): number;
declare function addEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | AddEventListenerOptions
): void;
declare function addEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
): void;
declare function removeEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | EventListenerOptions
): void;
declare function removeEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions
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
  abort(): void;
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
    options?: AddEventListenerOptions | boolean
  ): void;
  /** Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise. */
  dispatchEvent(event: Event): boolean;
  /** Removes the event listener in target's event listener list with the same type, callback, and options. */
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void;
}

declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

/** An event which takes place in the DOM. */
interface Event {
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
  readonly currentTarget: EventTarget | null;
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
  /** Returns a string containing a query string suitable for use in a URL. Does not include the question mark. */
  toString(): string;
  forEach(
    callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
    thisArg?: any
  ): void;
}

declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (
    init?: string[][] | Record<string, string> | string | URLSearchParams
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
  // exit: Event;
}

interface AbortSignalEventMap {
  abort: Event;
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
  onabort: ((this: AbortSignal, ev: Event) => any) | null;
  addEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

declare var AbortSignal: {
  prototype: AbortSignal;
  new (): AbortSignal;
};

// type AlgorithmIdentifier = Algorithm | string;
// type BodyInit = ReadableStream | XMLHttpRequestBodyInit;
type BufferSource = ArrayBufferView | ArrayBuffer;
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
 *
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
   *
   *
   */
  registry: Map<
    string,
    {
      /**
       * This refers to the state the ESM module is in
       *
       * TODO: make an enum for this number
       *
       *
       */
      state: number;
      dependencies: string[];
      /**
       * Your application will probably crash if you mess with this.
       */
      module: any;
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
   */
  resolve: (specifier: string) => Promise<string>;
  /**
   * Synchronously resolve a module specifier
   *
   * This may return a path to `node_modules.server.bun`, which will be confusing.
   *
   * Consider {@link Bun.resolveSync}
   * instead.
   */
  resolveSync: (specifier: string, from: string) => string;
};

/** This Streams API interface represents a readable stream of byte data. The Fetch API offers a concrete instance of a ReadableStream through the body property of a Response object. */
interface ReadableStream<R = any> {
  readonly locked: boolean;
  cancel(reason?: any): Promise<void>;
  getReader(): ReadableStreamDefaultReader<R>;
  pipeThrough<T>(
    transform: ReadableWritablePair<T, R>,
    options?: StreamPipeOptions
  ): ReadableStream<T>;
  pipeTo(
    destination: WritableStream<R>,
    options?: StreamPipeOptions
  ): Promise<void>;
  tee(): [ReadableStream<R>, ReadableStream<R>];
  forEach(
    callbackfn: (value: any, key: number, parent: ReadableStream<R>) => void,
    thisArg?: any
  ): void;
}

declare var ReadableStream: {
  prototype: ReadableStream;
  new <R = any>(
    underlyingSource?: DirectUnderlyingSource<R> | UnderlyingSource<R>,
    strategy?: QueuingStrategy<R>
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
interface ByteLengthQueuingStrategy extends QueuingStrategy<ArrayBufferView> {
  readonly highWaterMark: number;
  readonly size: QueuingStrategySize<ArrayBufferView>;
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
  write(data: ArrayBufferView | ArrayBuffer | string): number | Promise<number>;
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
    strategy?: QueuingStrategy<W>
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
    controller: TransformStreamDefaultController<O>
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
    controller: WritableStreamDefaultController
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
  type?: undefined;
}

interface DirectUnderlyingSource<R = any> {
  cancel?: UnderlyingSourceCancelCallback;
  pull: (
    controller: ReadableStreamDirectController
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
    readableStrategy?: QueuingStrategy<O>
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

declare function alert(message?: string): void;
declare function confirm(message?: string): boolean;
declare function prompt(message?: string, _default?: string): string | null;


// ./path.d.ts

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "path/posix" {
  /**
   * A parsed path object generated by path.parse() or consumed by path.format().
   */
  interface ParsedPath {
    /**
     * The root of the path such as '/' or 'c:\'
     */
    root: string;
    /**
     * The full directory path such as '/home/user/dir' or 'c:\path\dir'
     */
    dir: string;
    /**
     * The file name including extension (if any) such as 'index.html'
     */
    base: string;
    /**
     * The file extension (if any) such as '.html'
     */
    ext: string;
    /**
     * The file name without extension (if any) such as 'index'
     */
    name: string;
  }
  interface FormatInputPathObject {
    /**
     * The root of the path such as '/' or 'c:\'
     */
    root?: string | undefined;
    /**
     * The full directory path such as '/home/user/dir' or 'c:\path\dir'
     */
    dir?: string | undefined;
    /**
     * The file name including extension (if any) such as 'index.html'
     */
    base?: string | undefined;
    /**
     * The file extension (if any) such as '.html'
     */
    ext?: string | undefined;
    /**
     * The file name without extension (if any) such as 'index'
     */
    name?: string | undefined;
  }

  /**
   * Normalize a string path, reducing '..' and '.' parts.
   * When multiple slashes are found, they're replaced by a single one; when the path contains a trailing slash, it is preserved. On Windows backslashes are used.
   *
   * @param p string path to normalize.
   */
  export function normalize(p: string): string;
  /**
   * Join all arguments together and normalize the resulting path.
   * Arguments must be strings. In v0.8, non-string arguments were silently ignored. In v0.10 and up, an exception is thrown.
   *
   * @param paths paths to join.
   */
  export function join(...paths: string[]): string;
  /**
   * The right-most parameter is considered {to}.  Other parameters are considered an array of {from}.
   *
   * Starting from leftmost {from} parameter, resolves {to} to an absolute path.
   *
   * If {to} isn't already absolute, {from} arguments are prepended in right to left order,
   * until an absolute path is found. If after using all {from} paths still no absolute path is found,
   * the current working directory is used as well. The resulting path is normalized,
   * and trailing slashes are removed unless the path gets resolved to the root directory.
   *
   * @param pathSegments string paths to join.  Non-string arguments are ignored.
   */
  export function resolve(...pathSegments: string[]): string;
  /**
   * Determines whether {path} is an absolute path. An absolute path will always resolve to the same location, regardless of the working directory.
   *
   * @param path path to test.
   */
  export function isAbsolute(p: string): boolean;
  /**
   * Solve the relative path from {from} to {to}.
   * At times we have two absolute paths, and we need to derive the relative path from one to the other. This is actually the reverse transform of path.resolve.
   */
  export function relative(from: string, to: string): string;
  /**
   * Return the directory name of a path. Similar to the Unix dirname command.
   *
   * @param p the path to evaluate.
   */
  export function dirname(p: string): string;
  /**
   * Return the last portion of a path. Similar to the Unix basename command.
   * Often used to extract the file name from a fully qualified path.
   *
   * @param p the path to evaluate.
   * @param ext optionally, an extension to remove from the result.
   */
  export function basename(p: string, ext?: string): string;
  /**
   * Return the extension of the path, from the last '.' to end of string in the last portion of the path.
   * If there is no '.' in the last portion of the path or the first character of it is '.', then it returns an empty string
   *
   * @param p the path to evaluate.
   */
  export function extname(p: string): string;
  /**
   * The platform-specific file separator. '\\' or '/'.
   */
  export var sep: string;
  /**
   * The platform-specific file delimiter. ';' or ':'.
   */
  export var delimiter: string;
  /**
   * Returns an object from a path string - the opposite of format().
   *
   * @param pathString path to evaluate.
   */
  export function parse(p: string): ParsedPath;
  /**
   * Returns a path string from an object - the opposite of parse().
   *
   * @param pathString path to evaluate.
   */
  export function format(pP: FormatInputPathObject): string;
  /**
   * On Windows systems only, returns an equivalent namespace-prefixed path for the given path.
   * If path is not a string, path will be returned without modifications.
   * This method is meaningful only on Windows system.
   * On POSIX systems, the method is non-operational and always returns path without modifications.
   */
  export function toNamespacedPath(path: string): string;
}

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "path/win32" {
  export * from "path/posix";
}

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "path" {
  export * from "path/posix";
  export * as posix from "path/posix";
  export * as win32 from "path/win32";
}

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "node:path" {
  export * from "path";
}
/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "node:path/posix" {
  export * from "path/posix";
}
/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "node:path/win32" {
  export * from "path/win32";
}


// ./bun-test.d.ts

/**
 *
 * This isn't really designed for third-party usage yet.
 * You can try it if you want though!
 *
 * To run the tests, run `bun wiptest`
 *
 * @example
 *
 * ```bash
 * $ bun wiptest
 * ```
 *
 * @example
 * ```bash
 * $ bun wiptest file-name
 * ```
 */

declare module "bun:test" {
  export function describe(label: string, body: () => void): any;
  export function it(label: string, test: () => void | Promise<any>): any;
  export function test(label: string, test: () => void | Promise<any>): any;

  export function expect(value: any): Expect;

  interface Expect {
    toBe(value: any): void;
    toContain(value: any): void;
  }
}

declare module "test" {
  import BunTestModule = require("bun:test");
  export = BunTestModule;
}


// ./jsc.d.ts

declare module "bun:jsc" {
  export function describe(value: any): string;
  export function describeArray(args: any[]): string;
  export function gcAndSweep(): void;
  export function fullGC(): void;
  export function edenGC(): void;
  export function heapSize(): number;
  export function heapStats(): {
    heapSize: number;
    heapCapacity: number;
    extraMemorySize: number;
    objectCount: number;
    protectedObjectCount: number;
    globalObjectCount: number;
    protectedGlobalObjectCount: number;
    objectTypeCounts: Record<string, number>;
    protectedObjectTypeCounts: Record<string, number>;
  };
  export function memoryUsage(): {
    current: number;
    peak: number;
    currentCommit: number;
    peakCommit: number;
    pageFaults: number;
  };
  export function getRandomSeed(): number;
  export function setRandomSeed(value: number): void;
  export function isRope(input: string): boolean;
  export function callerSourceOrigin(): string;
  export function noFTL(func: Function): Function;
  export function noOSRExitFuzzing(func: Function): Function;
  export function optimizeNextInvocation(func: Function): Function;
  export function numberOfDFGCompiles(func: Function): number;
  export function releaseWeakRefs(): void;
  export function totalCompileTime(func: Function): number;
  export function reoptimizationRetryCount(func: Function): number;
  export function drainMicrotasks(): void;

  /**
   * This returns objects which native code has explicitly protected from being
   * garbage collected
   *
   * By calling this function you create another reference to the object, which
   * will further prevent it from being garbage collected
   *
   * This function is mostly a debugging tool for bun itself.
   *
   * Warning: not all objects returned are supposed to be observable from JavaScript
   */
  export function getProtectedObjects(): any[];

  /**
   * Start a remote debugging socket server on the given port.
   *
   * This exposes JavaScriptCore's built-in debugging server.
   *
   * This is untested. May not be supported yet on macOS
   */
  export function startRemoteDebugger(host?: string, port?: number): void;
}


// ./assert.d.ts

/**
 * The `assert` module provides a set of assertion functions for verifying
 * invariants.
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/assert.js)
 */
 declare module 'assert' {
  /**
   * An alias of {@link ok}.
   * @param value The input that is checked for being truthy.
   */
  function assert(value: unknown, message?: string | Error): asserts value;
  namespace assert {
      /**
       * Indicates the failure of an assertion. All errors thrown by the `assert` module
       * will be instances of the `AssertionError` class.
       */
      class AssertionError extends Error {
          actual: unknown;
          expected: unknown;
          operator: string;
          generatedMessage: boolean;
          code: 'ERR_ASSERTION';
          constructor(options?: {
              /** If provided, the error message is set to this value. */
              message?: string | undefined;
              /** The `actual` property on the error instance. */
              actual?: unknown | undefined;
              /** The `expected` property on the error instance. */
              expected?: unknown | undefined;
              /** The `operator` property on the error instance. */
              operator?: string | undefined;
              /** If provided, the generated stack trace omits frames before this function. */
              // tslint:disable-next-line:ban-types
              stackStartFn?: Function | undefined;
          });
      }
      /**
       * This feature is currently experimental and behavior might still change.
       * @experimental
       */
      class CallTracker {
          /**
           * The wrapper function is expected to be called exactly `exact` times. If the
           * function has not been called exactly `exact` times when `tracker.verify()` is called, then `tracker.verify()` will throw an
           * error.
           *
           * ```js
           * import assert from 'assert';
           *
           * // Creates call tracker.
           * const tracker = new assert.CallTracker();
           *
           * function func() {}
           *
           * // Returns a function that wraps func() that must be called exact times
           * // before tracker.verify().
           * const callsfunc = tracker.calls(func);
           * ```
           * @param [fn='A no-op function']
           * @param [exact=1]
           * @return that wraps `fn`.
           */
          calls(exact?: number): () => void;
          calls<Func extends (...args: any[]) => any>(fn?: Func, exact?: number): Func;
          /**
           * The arrays contains information about the expected and actual number of calls of
           * the functions that have not been called the expected number of times.
           *
           * ```js
           * import assert from 'assert';
           *
           * // Creates call tracker.
           * const tracker = new assert.CallTracker();
           *
           * function func() {}
           *
           * function foo() {}
           *
           * // Returns a function that wraps func() that must be called exact times
           * // before tracker.verify().
           * const callsfunc = tracker.calls(func, 2);
           *
           * // Returns an array containing information on callsfunc()
           * tracker.report();
           * // [
           * //  {
           * //    message: 'Expected the func function to be executed 2 time(s) but was
           * //    executed 0 time(s).',
           * //    actual: 0,
           * //    expected: 2,
           * //    operator: 'func',
           * //    stack: stack trace
           * //  }
           * // ]
           * ```
           * @return of objects containing information about the wrapper functions returned by `calls`.
           */
          report(): CallTrackerReportInformation[];
          /**
           * Iterates through the list of functions passed to `tracker.calls()` and will throw an error for functions that
           * have not been called the expected number of times.
           *
           * ```js
           * import assert from 'assert';
           *
           * // Creates call tracker.
           * const tracker = new assert.CallTracker();
           *
           * function func() {}
           *
           * // Returns a function that wraps func() that must be called exact times
           * // before tracker.verify().
           * const callsfunc = tracker.calls(func, 2);
           *
           * callsfunc();
           *
           * // Will throw an error since callsfunc() was only called once.
           * tracker.verify();
           * ```
           */
          verify(): void;
      }
      interface CallTrackerReportInformation {
          message: string;
          /** The actual number of times the function was called. */
          actual: number;
          /** The number of times the function was expected to be called. */
          expected: number;
          /** The name of the function that is wrapped. */
          operator: string;
          /** A stack trace of the function. */
          stack: object;
      }
      type AssertPredicate = RegExp | (new () => object) | ((thrown: unknown) => boolean) | object | Error;
      /**
       * Throws an `AssertionError` with the provided error message or a default
       * error message. If the `message` parameter is an instance of an `Error` then
       * it will be thrown instead of the `AssertionError`.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.fail();
       * // AssertionError [ERR_ASSERTION]: Failed
       *
       * assert.fail('boom');
       * // AssertionError [ERR_ASSERTION]: boom
       *
       * assert.fail(new TypeError('need array'));
       * // TypeError: need array
       * ```
       *
       * Using `assert.fail()` with more than two arguments is possible but deprecated.
       * See below for further details.
       * @param [message='Failed']
       */
      function fail(message?: string | Error): never;
      /** @deprecated since v10.0.0 - use fail([message]) or other assert functions instead. */
      function fail(
          actual: unknown,
          expected: unknown,
          message?: string | Error,
          operator?: string,
          // tslint:disable-next-line:ban-types
          stackStartFn?: Function
      ): never;
      /**
       * Tests if `value` is truthy. It is equivalent to`assert.equal(!!value, true, message)`.
       *
       * If `value` is not truthy, an `AssertionError` is thrown with a `message`property set equal to the value of the `message` parameter. If the `message`parameter is `undefined`, a default
       * error message is assigned. If the `message`parameter is an instance of an `Error` then it will be thrown instead of the`AssertionError`.
       * If no arguments are passed in at all `message` will be set to the string:`` 'No value argument passed to `assert.ok()`' ``.
       *
       * Be aware that in the `repl` the error message will be different to the one
       * thrown in a file! See below for further details.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.ok(true);
       * // OK
       * assert.ok(1);
       * // OK
       *
       * assert.ok();
       * // AssertionError: No value argument passed to `assert.ok()`
       *
       * assert.ok(false, 'it\'s false');
       * // AssertionError: it's false
       *
       * // In the repl:
       * assert.ok(typeof 123 === 'string');
       * // AssertionError: false == true
       *
       * // In a file (e.g. test.js):
       * assert.ok(typeof 123 === 'string');
       * // AssertionError: The expression evaluated to a falsy value:
       * //
       * //   assert.ok(typeof 123 === 'string')
       *
       * assert.ok(false);
       * // AssertionError: The expression evaluated to a falsy value:
       * //
       * //   assert.ok(false)
       *
       * assert.ok(0);
       * // AssertionError: The expression evaluated to a falsy value:
       * //
       * //   assert.ok(0)
       * ```
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * // Using `assert()` works the same:
       * assert(0);
       * // AssertionError: The expression evaluated to a falsy value:
       * //
       * //   assert(0)
       * ```
       */
      function ok(value: unknown, message?: string | Error): asserts value;
      /**
       * **Strict assertion mode**
       *
       * An alias of {@link strictEqual}.
       *
       * **Legacy assertion mode**
       *
       * > Stability: 3 - Legacy: Use {@link strictEqual} instead.
       *
       * Tests shallow, coercive equality between the `actual` and `expected` parameters
       * using the [`==` operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Equality). `NaN` is specially handled
       * and treated as being identical if both sides are `NaN`.
       *
       * ```js
       * import assert from 'assert';
       *
       * assert.equal(1, 1);
       * // OK, 1 == 1
       * assert.equal(1, '1');
       * // OK, 1 == '1'
       * assert.equal(NaN, NaN);
       * // OK
       *
       * assert.equal(1, 2);
       * // AssertionError: 1 == 2
       * assert.equal({ a: { b: 1 } }, { a: { b: 1 } });
       * // AssertionError: { a: { b: 1 } } == { a: { b: 1 } }
       * ```
       *
       * If the values are not equal, an `AssertionError` is thrown with a `message`property set equal to the value of the `message` parameter. If the `message`parameter is undefined, a default
       * error message is assigned. If the `message`parameter is an instance of an `Error` then it will be thrown instead of the`AssertionError`.
       */
      function equal(actual: unknown, expected: unknown, message?: string | Error): void;
      /**
       * **Strict assertion mode**
       *
       * An alias of {@link notStrictEqual}.
       *
       * **Legacy assertion mode**
       *
       * > Stability: 3 - Legacy: Use {@link notStrictEqual} instead.
       *
       * Tests shallow, coercive inequality with the [`!=` operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Inequality). `NaN` is
       * specially handled and treated as being identical if both sides are `NaN`.
       *
       * ```js
       * import assert from 'assert';
       *
       * assert.notEqual(1, 2);
       * // OK
       *
       * assert.notEqual(1, 1);
       * // AssertionError: 1 != 1
       *
       * assert.notEqual(1, '1');
       * // AssertionError: 1 != '1'
       * ```
       *
       * If the values are equal, an `AssertionError` is thrown with a `message`property set equal to the value of the `message` parameter. If the `message`parameter is undefined, a default error
       * message is assigned. If the `message`parameter is an instance of an `Error` then it will be thrown instead of the`AssertionError`.
       */
      function notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
      /**
       * **Strict assertion mode**
       *
       * An alias of {@link deepStrictEqual}.
       *
       * **Legacy assertion mode**
       *
       * > Stability: 3 - Legacy: Use {@link deepStrictEqual} instead.
       *
       * Tests for deep equality between the `actual` and `expected` parameters. Consider
       * using {@link deepStrictEqual} instead. {@link deepEqual} can have
       * surprising results.
       *
       * _Deep equality_ means that the enumerable "own" properties of child objects
       * are also recursively evaluated by the following rules.
       */
      function deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
      /**
       * **Strict assertion mode**
       *
       * An alias of {@link notDeepStrictEqual}.
       *
       * **Legacy assertion mode**
       *
       * > Stability: 3 - Legacy: Use {@link notDeepStrictEqual} instead.
       *
       * Tests for any deep inequality. Opposite of {@link deepEqual}.
       *
       * ```js
       * import assert from 'assert';
       *
       * const obj1 = {
       *   a: {
       *     b: 1
       *   }
       * };
       * const obj2 = {
       *   a: {
       *     b: 2
       *   }
       * };
       * const obj3 = {
       *   a: {
       *     b: 1
       *   }
       * };
       * const obj4 = Object.create(obj1);
       *
       * assert.notDeepEqual(obj1, obj1);
       * // AssertionError: { a: { b: 1 } } notDeepEqual { a: { b: 1 } }
       *
       * assert.notDeepEqual(obj1, obj2);
       * // OK
       *
       * assert.notDeepEqual(obj1, obj3);
       * // AssertionError: { a: { b: 1 } } notDeepEqual { a: { b: 1 } }
       *
       * assert.notDeepEqual(obj1, obj4);
       * // OK
       * ```
       *
       * If the values are deeply equal, an `AssertionError` is thrown with a`message` property set equal to the value of the `message` parameter. If the`message` parameter is undefined, a default
       * error message is assigned. If the`message` parameter is an instance of an `Error` then it will be thrown
       * instead of the `AssertionError`.
       */
      function notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
      /**
       * Tests strict equality between the `actual` and `expected` parameters as
       * determined by [`Object.is()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is).
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.strictEqual(1, 2);
       * // AssertionError [ERR_ASSERTION]: Expected inputs to be strictly equal:
       * //
       * // 1 !== 2
       *
       * assert.strictEqual(1, 1);
       * // OK
       *
       * assert.strictEqual('Hello foobar', 'Hello World!');
       * // AssertionError [ERR_ASSERTION]: Expected inputs to be strictly equal:
       * // + actual - expected
       * //
       * // + 'Hello foobar'
       * // - 'Hello World!'
       * //          ^
       *
       * const apples = 1;
       * const oranges = 2;
       * assert.strictEqual(apples, oranges, `apples ${apples} !== oranges ${oranges}`);
       * // AssertionError [ERR_ASSERTION]: apples 1 !== oranges 2
       *
       * assert.strictEqual(1, '1', new TypeError('Inputs are not identical'));
       * // TypeError: Inputs are not identical
       * ```
       *
       * If the values are not strictly equal, an `AssertionError` is thrown with a`message` property set equal to the value of the `message` parameter. If the`message` parameter is undefined, a
       * default error message is assigned. If the`message` parameter is an instance of an `Error` then it will be thrown
       * instead of the `AssertionError`.
       */
      function strictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
      /**
       * Tests strict inequality between the `actual` and `expected` parameters as
       * determined by [`Object.is()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is).
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.notStrictEqual(1, 2);
       * // OK
       *
       * assert.notStrictEqual(1, 1);
       * // AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to:
       * //
       * // 1
       *
       * assert.notStrictEqual(1, '1');
       * // OK
       * ```
       *
       * If the values are strictly equal, an `AssertionError` is thrown with a`message` property set equal to the value of the `message` parameter. If the`message` parameter is undefined, a
       * default error message is assigned. If the`message` parameter is an instance of an `Error` then it will be thrown
       * instead of the `AssertionError`.
       */
      function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
      /**
       * Tests for deep equality between the `actual` and `expected` parameters.
       * "Deep" equality means that the enumerable "own" properties of child objects
       * are recursively evaluated also by the following rules.
       */
      function deepStrictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
      /**
       * Tests for deep strict inequality. Opposite of {@link deepStrictEqual}.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.notDeepStrictEqual({ a: 1 }, { a: '1' });
       * // OK
       * ```
       *
       * If the values are deeply and strictly equal, an `AssertionError` is thrown
       * with a `message` property set equal to the value of the `message` parameter. If
       * the `message` parameter is undefined, a default error message is assigned. If
       * the `message` parameter is an instance of an `Error` then it will be thrown
       * instead of the `AssertionError`.
       */
      function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
      /**
       * Expects the function `fn` to throw an error.
       *
       * If specified, `error` can be a [`Class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes),
       * [`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions), a validation function,
       * a validation object where each property will be tested for strict deep equality,
       * or an instance of error where each property will be tested for strict deep
       * equality including the non-enumerable `message` and `name` properties. When
       * using an object, it is also possible to use a regular expression, when
       * validating against a string property. See below for examples.
       *
       * If specified, `message` will be appended to the message provided by the`AssertionError` if the `fn` call fails to throw or in case the error validation
       * fails.
       *
       * Custom validation object/error instance:
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * const err = new TypeError('Wrong value');
       * err.code = 404;
       * err.foo = 'bar';
       * err.info = {
       *   nested: true,
       *   baz: 'text'
       * };
       * err.reg = /abc/i;
       *
       * assert.throws(
       *   () => {
       *     throw err;
       *   },
       *   {
       *     name: 'TypeError',
       *     message: 'Wrong value',
       *     info: {
       *       nested: true,
       *       baz: 'text'
       *     }
       *     // Only properties on the validation object will be tested for.
       *     // Using nested objects requires all properties to be present. Otherwise
       *     // the validation is going to fail.
       *   }
       * );
       *
       * // Using regular expressions to validate error properties:
       * throws(
       *   () => {
       *     throw err;
       *   },
       *   {
       *     // The `name` and `message` properties are strings and using regular
       *     // expressions on those will match against the string. If they fail, an
       *     // error is thrown.
       *     name: /^TypeError$/,
       *     message: /Wrong/,
       *     foo: 'bar',
       *     info: {
       *       nested: true,
       *       // It is not possible to use regular expressions for nested properties!
       *       baz: 'text'
       *     },
       *     // The `reg` property contains a regular expression and only if the
       *     // validation object contains an identical regular expression, it is going
       *     // to pass.
       *     reg: /abc/i
       *   }
       * );
       *
       * // Fails due to the different `message` and `name` properties:
       * throws(
       *   () => {
       *     const otherErr = new Error('Not found');
       *     // Copy all enumerable properties from `err` to `otherErr`.
       *     for (const [key, value] of Object.entries(err)) {
       *       otherErr[key] = value;
       *     }
       *     throw otherErr;
       *   },
       *   // The error's `message` and `name` properties will also be checked when using
       *   // an error as validation object.
       *   err
       * );
       * ```
       *
       * Validate instanceof using constructor:
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.throws(
       *   () => {
       *     throw new Error('Wrong value');
       *   },
       *   Error
       * );
       * ```
       *
       * Validate error message using [`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions):
       *
       * Using a regular expression runs `.toString` on the error object, and will
       * therefore also include the error name.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.throws(
       *   () => {
       *     throw new Error('Wrong value');
       *   },
       *   /^Error: Wrong value$/
       * );
       * ```
       *
       * Custom error validation:
       *
       * The function must return `true` to indicate all internal validations passed.
       * It will otherwise fail with an `AssertionError`.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.throws(
       *   () => {
       *     throw new Error('Wrong value');
       *   },
       *   (err) => {
       *     assert(err instanceof Error);
       *     assert(/value/.test(err));
       *     // Avoid returning anything from validation functions besides `true`.
       *     // Otherwise, it's not clear what part of the validation failed. Instead,
       *     // throw an error about the specific validation that failed (as done in this
       *     // example) and add as much helpful debugging information to that error as
       *     // possible.
       *     return true;
       *   },
       *   'unexpected error'
       * );
       * ```
       *
       * `error` cannot be a string. If a string is provided as the second
       * argument, then `error` is assumed to be omitted and the string will be used for`message` instead. This can lead to easy-to-miss mistakes. Using the same
       * message as the thrown error message is going to result in an`ERR_AMBIGUOUS_ARGUMENT` error. Please read the example below carefully if using
       * a string as the second argument gets considered:
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * function throwingFirst() {
       *   throw new Error('First');
       * }
       *
       * function throwingSecond() {
       *   throw new Error('Second');
       * }
       *
       * function notThrowing() {}
       *
       * // The second argument is a string and the input function threw an Error.
       * // The first case will not throw as it does not match for the error message
       * // thrown by the input function!
       * assert.throws(throwingFirst, 'Second');
       * // In the next example the message has no benefit over the message from the
       * // error and since it is not clear if the user intended to actually match
       * // against the error message, Node.js throws an `ERR_AMBIGUOUS_ARGUMENT` error.
       * assert.throws(throwingSecond, 'Second');
       * // TypeError [ERR_AMBIGUOUS_ARGUMENT]
       *
       * // The string is only used (as message) in case the function does not throw:
       * assert.throws(notThrowing, 'Second');
       * // AssertionError [ERR_ASSERTION]: Missing expected exception: Second
       *
       * // If it was intended to match for the error message do this instead:
       * // It does not throw because the error messages match.
       * assert.throws(throwingSecond, /Second$/);
       *
       * // If the error message does not match, an AssertionError is thrown.
       * assert.throws(throwingFirst, /Second$/);
       * // AssertionError [ERR_ASSERTION]
       * ```
       *
       * Due to the confusing error-prone notation, avoid a string as the second
       * argument.
       */
      function throws(block: () => unknown, message?: string | Error): void;
      function throws(block: () => unknown, error: AssertPredicate, message?: string | Error): void;
      /**
       * Asserts that the function `fn` does not throw an error.
       *
       * Using `assert.doesNotThrow()` is actually not useful because there
       * is no benefit in catching an error and then rethrowing it. Instead, consider
       * adding a comment next to the specific code path that should not throw and keep
       * error messages as expressive as possible.
       *
       * When `assert.doesNotThrow()` is called, it will immediately call the `fn`function.
       *
       * If an error is thrown and it is the same type as that specified by the `error`parameter, then an `AssertionError` is thrown. If the error is of a
       * different type, or if the `error` parameter is undefined, the error is
       * propagated back to the caller.
       *
       * If specified, `error` can be a [`Class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes),
       * [`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions) or a validation
       * function. See {@link throws} for more details.
       *
       * The following, for instance, will throw the `TypeError` because there is no
       * matching error type in the assertion:
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.doesNotThrow(
       *   () => {
       *     throw new TypeError('Wrong value');
       *   },
       *   SyntaxError
       * );
       * ```
       *
       * However, the following will result in an `AssertionError` with the message
       * 'Got unwanted exception...':
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.doesNotThrow(
       *   () => {
       *     throw new TypeError('Wrong value');
       *   },
       *   TypeError
       * );
       * ```
       *
       * If an `AssertionError` is thrown and a value is provided for the `message`parameter, the value of `message` will be appended to the `AssertionError` message:
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.doesNotThrow(
       *   () => {
       *     throw new TypeError('Wrong value');
       *   },
       *   /Wrong value/,
       *   'Whoops'
       * );
       * // Throws: AssertionError: Got unwanted exception: Whoops
       * ```
       */
      function doesNotThrow(block: () => unknown, message?: string | Error): void;
      function doesNotThrow(block: () => unknown, error: AssertPredicate, message?: string | Error): void;
      /**
       * Throws `value` if `value` is not `undefined` or `null`. This is useful when
       * testing the `error` argument in callbacks. The stack trace contains all frames
       * from the error passed to `ifError()` including the potential new frames for`ifError()` itself.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.ifError(null);
       * // OK
       * assert.ifError(0);
       * // AssertionError [ERR_ASSERTION]: ifError got unwanted exception: 0
       * assert.ifError('error');
       * // AssertionError [ERR_ASSERTION]: ifError got unwanted exception: 'error'
       * assert.ifError(new Error());
       * // AssertionError [ERR_ASSERTION]: ifError got unwanted exception: Error
       *
       * // Create some random error frames.
       * let err;
       * (function errorFrame() {
       *   err = new Error('test error');
       * })();
       *
       * (function ifErrorFrame() {
       *   assert.ifError(err);
       * })();
       * // AssertionError [ERR_ASSERTION]: ifError got unwanted exception: test error
       * //     at ifErrorFrame
       * //     at errorFrame
       * ```
       */
      function ifError(value: unknown): asserts value is null | undefined;
      /**
       * Awaits the `asyncFn` promise or, if `asyncFn` is a function, immediately
       * calls the function and awaits the returned promise to complete. It will then
       * check that the promise is rejected.
       *
       * If `asyncFn` is a function and it throws an error synchronously,`assert.rejects()` will return a rejected `Promise` with that error. If the
       * function does not return a promise, `assert.rejects()` will return a rejected`Promise` with an `ERR_INVALID_RETURN_VALUE` error. In both cases the error
       * handler is skipped.
       *
       * Besides the async nature to await the completion behaves identically to {@link throws}.
       *
       * If specified, `error` can be a [`Class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes),
       * [`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions), a validation function,
       * an object where each property will be tested for, or an instance of error where
       * each property will be tested for including the non-enumerable `message` and`name` properties.
       *
       * If specified, `message` will be the message provided by the `AssertionError` if the `asyncFn` fails to reject.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * await assert.rejects(
       *   async () => {
       *     throw new TypeError('Wrong value');
       *   },
       *   {
       *     name: 'TypeError',
       *     message: 'Wrong value'
       *   }
       * );
       * ```
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * await assert.rejects(
       *   async () => {
       *     throw new TypeError('Wrong value');
       *   },
       *   (err) => {
       *     assert.strictEqual(err.name, 'TypeError');
       *     assert.strictEqual(err.message, 'Wrong value');
       *     return true;
       *   }
       * );
       * ```
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.rejects(
       *   Promise.reject(new Error('Wrong value')),
       *   Error
       * ).then(() => {
       *   // ...
       * });
       * ```
       *
       * `error` cannot be a string. If a string is provided as the second
       * argument, then `error` is assumed to be omitted and the string will be used for`message` instead. This can lead to easy-to-miss mistakes. Please read the
       * example in {@link throws} carefully if using a string as the second
       * argument gets considered.
       */
      function rejects(block: (() => Promise<unknown>) | Promise<unknown>, message?: string | Error): Promise<void>;
      function rejects(block: (() => Promise<unknown>) | Promise<unknown>, error: AssertPredicate, message?: string | Error): Promise<void>;
      /**
       * Awaits the `asyncFn` promise or, if `asyncFn` is a function, immediately
       * calls the function and awaits the returned promise to complete. It will then
       * check that the promise is not rejected.
       *
       * If `asyncFn` is a function and it throws an error synchronously,`assert.doesNotReject()` will return a rejected `Promise` with that error. If
       * the function does not return a promise, `assert.doesNotReject()` will return a
       * rejected `Promise` with an `ERR_INVALID_RETURN_VALUE` error. In both cases
       * the error handler is skipped.
       *
       * Using `assert.doesNotReject()` is actually not useful because there is little
       * benefit in catching a rejection and then rejecting it again. Instead, consider
       * adding a comment next to the specific code path that should not reject and keep
       * error messages as expressive as possible.
       *
       * If specified, `error` can be a [`Class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes),
       * [`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions) or a validation
       * function. See {@link throws} for more details.
       *
       * Besides the async nature to await the completion behaves identically to {@link doesNotThrow}.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * await assert.doesNotReject(
       *   async () => {
       *     throw new TypeError('Wrong value');
       *   },
       *   SyntaxError
       * );
       * ```
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.doesNotReject(Promise.reject(new TypeError('Wrong value')))
       *   .then(() => {
       *     // ...
       *   });
       * ```
       */
      function doesNotReject(block: (() => Promise<unknown>) | Promise<unknown>, message?: string | Error): Promise<void>;
      function doesNotReject(block: (() => Promise<unknown>) | Promise<unknown>, error: AssertPredicate, message?: string | Error): Promise<void>;
      /**
       * Expects the `string` input to match the regular expression.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.match('I will fail', /pass/);
       * // AssertionError [ERR_ASSERTION]: The input did not match the regular ...
       *
       * assert.match(123, /pass/);
       * // AssertionError [ERR_ASSERTION]: The "string" argument must be of type string.
       *
       * assert.match('I will pass', /pass/);
       * // OK
       * ```
       *
       * If the values do not match, or if the `string` argument is of another type than`string`, an `AssertionError` is thrown with a `message` property set equal
       * to the value of the `message` parameter. If the `message` parameter is
       * undefined, a default error message is assigned. If the `message` parameter is an
       * instance of an `Error` then it will be thrown instead of the `AssertionError`.
       */
      function match(value: string, regExp: RegExp, message?: string | Error): void;
      /**
       * Expects the `string` input not to match the regular expression.
       *
       * ```js
       * import assert from 'assert/strict';
       *
       * assert.doesNotMatch('I will fail', /fail/);
       * // AssertionError [ERR_ASSERTION]: The input was expected to not match the ...
       *
       * assert.doesNotMatch(123, /pass/);
       * // AssertionError [ERR_ASSERTION]: The "string" argument must be of type string.
       *
       * assert.doesNotMatch('I will pass', /different/);
       * // OK
       * ```
       *
       * If the values do match, or if the `string` argument is of another type than`string`, an `AssertionError` is thrown with a `message` property set equal
       * to the value of the `message` parameter. If the `message` parameter is
       * undefined, a default error message is assigned. If the `message` parameter is an
       * instance of an `Error` then it will be thrown instead of the `AssertionError`.
       */
      // FIXME: assert.doesNotMatch is typed, but not in the browserify polyfill?
      // function doesNotMatch(value: string, regExp: RegExp, message?: string | Error): void;

      const strict: Omit<typeof assert, 'equal' | 'notEqual' | 'deepEqual' | 'notDeepEqual' | 'ok' | 'strictEqual' | 'deepStrictEqual' | 'ifError' | 'strict'> & {
          (value: unknown, message?: string | Error): asserts value;
          equal: typeof strictEqual;
          notEqual: typeof notStrictEqual;
          deepEqual: typeof deepStrictEqual;
          notDeepEqual: typeof notDeepStrictEqual;
          // Mapped types and assertion functions are incompatible?
          // TS2775: Assertions require every name in the call target
          // to be declared with an explicit type annotation.
          ok: typeof ok;
          strictEqual: typeof strictEqual;
          deepStrictEqual: typeof deepStrictEqual;
          ifError: typeof ifError;
          strict: typeof strict;
      };
  }
  export = assert;
}
declare module 'node:assert' {
  import assert = require('assert');
  export = assert;
}

// ./events.d.ts

/**
 * Much of the Node.js core API is built around an idiomatic asynchronous
 * event-driven architecture in which certain kinds of objects (called "emitters")
 * emit named events that cause `Function` objects ("listeners") to be called.
 *
 * For instance: a `net.Server` object emits an event each time a peer
 * connects to it; a `fs.ReadStream` emits an event when the file is opened;
 * a `stream` emits an event whenever data is available to be read.
 *
 * All objects that emit events are instances of the `EventEmitter` class. These
 * objects expose an `eventEmitter.on()` function that allows one or more
 * functions to be attached to named events emitted by the object. Typically,
 * event names are camel-cased strings but any valid JavaScript property key
 * can be used.
 *
 * When the `EventEmitter` object emits an event, all of the functions attached
 * to that specific event are called _synchronously_. Any values returned by the
 * called listeners are _ignored_ and discarded.
 *
 * The following example shows a simple `EventEmitter` instance with a single
 * listener. The `eventEmitter.on()` method is used to register listeners, while
 * the `eventEmitter.emit()` method is used to trigger the event.
 *
 * ```js
 * const EventEmitter = require('events');
 *
 * class MyEmitter extends EventEmitter {}
 *
 * const myEmitter = new MyEmitter();
 * myEmitter.on('event', () => {
 *   console.log('an event occurred!');
 * });
 * myEmitter.emit('event');
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/events.js)
 */
 declare module 'events' {
  interface EventEmitterOptions {
      /**
       * Enables automatic capturing of promise rejection.
       */
      captureRejections?: boolean | undefined;
  }
  interface NodeEventTarget {
      once(eventName: string | symbol, listener: (...args: any[]) => void): this;
  }
  interface DOMEventTarget {
      addEventListener(
          eventName: string,
          listener: (...args: any[]) => void,
          opts?: {
              once: boolean;
          }
      ): any;
  }
  interface StaticEventEmitterOptions {
      signal?: AbortSignal | undefined;
  }
  interface EventEmitter {
      /**
       * Alias for `emitter.on(eventName, listener)`.
       */
      addListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Adds the `listener` function to the end of the listeners array for the
       * event named `eventName`. No checks are made to see if the `listener` has
       * already been added. Multiple calls passing the same combination of `eventName`and `listener` will result in the `listener` being added, and called, multiple
       * times.
       *
       * ```js
       * server.on('connection', (stream) => {
       *   console.log('someone connected!');
       * });
       * ```
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       *
       * By default, event listeners are invoked in the order they are added. The`emitter.prependListener()` method can be used as an alternative to add the
       * event listener to the beginning of the listeners array.
       *
       * ```js
       * const myEE = new EventEmitter();
       * myEE.on('foo', () => console.log('a'));
       * myEE.prependListener('foo', () => console.log('b'));
       * myEE.emit('foo');
       * // Prints:
       * //   b
       * //   a
       * ```
       * @param eventName The name of the event.
       * @param listener The callback function
       */
      on(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Adds a **one-time**`listener` function for the event named `eventName`. The
       * next time `eventName` is triggered, this listener is removed and then invoked.
       *
       * ```js
       * server.once('connection', (stream) => {
       *   console.log('Ah, we have our first user!');
       * });
       * ```
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       *
       * By default, event listeners are invoked in the order they are added. The`emitter.prependOnceListener()` method can be used as an alternative to add the
       * event listener to the beginning of the listeners array.
       *
       * ```js
       * const myEE = new EventEmitter();
       * myEE.once('foo', () => console.log('a'));
       * myEE.prependOnceListener('foo', () => console.log('b'));
       * myEE.emit('foo');
       * // Prints:
       * //   b
       * //   a
       * ```
       * @param eventName The name of the event.
       * @param listener The callback function
       */
      once(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Removes the specified `listener` from the listener array for the event named`eventName`.
       *
       * ```js
       * const callback = (stream) => {
       *   console.log('someone connected!');
       * };
       * server.on('connection', callback);
       * // ...
       * server.removeListener('connection', callback);
       * ```
       *
       * `removeListener()` will remove, at most, one instance of a listener from the
       * listener array. If any single listener has been added multiple times to the
       * listener array for the specified `eventName`, then `removeListener()` must be
       * called multiple times to remove each instance.
       *
       * Once an event is emitted, all listeners attached to it at the
       * time of emitting are called in order. This implies that any`removeListener()` or `removeAllListeners()` calls _after_ emitting and_before_ the last listener finishes execution will
       * not remove them from`emit()` in progress. Subsequent events behave as expected.
       *
       * ```js
       * const myEmitter = new MyEmitter();
       *
       * const callbackA = () => {
       *   console.log('A');
       *   myEmitter.removeListener('event', callbackB);
       * };
       *
       * const callbackB = () => {
       *   console.log('B');
       * };
       *
       * myEmitter.on('event', callbackA);
       *
       * myEmitter.on('event', callbackB);
       *
       * // callbackA removes listener callbackB but it will still be called.
       * // Internal listener array at time of emit [callbackA, callbackB]
       * myEmitter.emit('event');
       * // Prints:
       * //   A
       * //   B
       *
       * // callbackB is now removed.
       * // Internal listener array [callbackA]
       * myEmitter.emit('event');
       * // Prints:
       * //   A
       * ```
       *
       * Because listeners are managed using an internal array, calling this will
       * change the position indices of any listener registered _after_ the listener
       * being removed. This will not impact the order in which listeners are called,
       * but it means that any copies of the listener array as returned by
       * the `emitter.listeners()` method will need to be recreated.
       *
       * When a single function has been added as a handler multiple times for a single
       * event (as in the example below), `removeListener()` will remove the most
       * recently added instance. In the example the `once('ping')`listener is removed:
       *
       * ```js
       * const ee = new EventEmitter();
       *
       * function pong() {
       *   console.log('pong');
       * }
       *
       * ee.on('ping', pong);
       * ee.once('ping', pong);
       * ee.removeListener('ping', pong);
       *
       * ee.emit('ping');
       * ee.emit('ping');
       * ```
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       */
      removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Alias for `emitter.removeListener()`.
       */
      off(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Removes all listeners, or those of the specified `eventName`.
       *
       * It is bad practice to remove listeners added elsewhere in the code,
       * particularly when the `EventEmitter` instance was created by some other
       * component or module (e.g. sockets or file streams).
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       */
      removeAllListeners(event?: string | symbol): this;
      /**
       * By default `EventEmitter`s will print a warning if more than `10` listeners are
       * added for a particular event. This is a useful default that helps finding
       * memory leaks. The `emitter.setMaxListeners()` method allows the limit to be
       * modified for this specific `EventEmitter` instance. The value can be set to`Infinity` (or `0`) to indicate an unlimited number of listeners.
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       */
      setMaxListeners(n: number): this;
      /**
       * Returns the current max listener value for the `EventEmitter` which is either
       * set by `emitter.setMaxListeners(n)` or defaults to {@link defaultMaxListeners}.
       */
      getMaxListeners(): number;
      /**
       * Returns a copy of the array of listeners for the event named `eventName`.
       *
       * ```js
       * server.on('connection', (stream) => {
       *   console.log('someone connected!');
       * });
       * console.log(util.inspect(server.listeners('connection')));
       * // Prints: [ [Function] ]
       * ```
       */
      listeners(eventName: string | symbol): Function[];
      /**
       * Returns a copy of the array of listeners for the event named `eventName`,
       * including any wrappers (such as those created by `.once()`).
       *
       * ```js
       * const emitter = new EventEmitter();
       * emitter.once('log', () => console.log('log once'));
       *
       * // Returns a new Array with a function `onceWrapper` which has a property
       * // `listener` which contains the original listener bound above
       * const listeners = emitter.rawListeners('log');
       * const logFnWrapper = listeners[0];
       *
       * // Logs "log once" to the console and does not unbind the `once` event
       * logFnWrapper.listener();
       *
       * // Logs "log once" to the console and removes the listener
       * logFnWrapper();
       *
       * emitter.on('log', () => console.log('log persistently'));
       * // Will return a new Array with a single function bound by `.on()` above
       * const newListeners = emitter.rawListeners('log');
       *
       * // Logs "log persistently" twice
       * newListeners[0]();
       * emitter.emit('log');
       * ```
       */
      rawListeners(eventName: string | symbol): Function[];
      /**
       * Synchronously calls each of the listeners registered for the event named`eventName`, in the order they were registered, passing the supplied arguments
       * to each.
       *
       * Returns `true` if the event had listeners, `false` otherwise.
       *
       * ```js
       * const EventEmitter = require('events');
       * const myEmitter = new EventEmitter();
       *
       * // First listener
       * myEmitter.on('event', function firstListener() {
       *   console.log('Helloooo! first listener');
       * });
       * // Second listener
       * myEmitter.on('event', function secondListener(arg1, arg2) {
       *   console.log(`event with parameters ${arg1}, ${arg2} in second listener`);
       * });
       * // Third listener
       * myEmitter.on('event', function thirdListener(...args) {
       *   const parameters = args.join(', ');
       *   console.log(`event with parameters ${parameters} in third listener`);
       * });
       *
       * console.log(myEmitter.listeners('event'));
       *
       * myEmitter.emit('event', 1, 2, 3, 4, 5);
       *
       * // Prints:
       * // [
       * //   [Function: firstListener],
       * //   [Function: secondListener],
       * //   [Function: thirdListener]
       * // ]
       * // Helloooo! first listener
       * // event with parameters 1, 2 in second listener
       * // event with parameters 1, 2, 3, 4, 5 in third listener
       * ```
       */
      emit(eventName: string | symbol, ...args: any[]): boolean;
      /**
       * Returns the number of listeners listening to the event named `eventName`.
       * @param eventName The name of the event being listened for
       */
      listenerCount(eventName: string | symbol): number;
      /**
       * Adds the `listener` function to the _beginning_ of the listeners array for the
       * event named `eventName`. No checks are made to see if the `listener` has
       * already been added. Multiple calls passing the same combination of `eventName`and `listener` will result in the `listener` being added, and called, multiple
       * times.
       *
       * ```js
       * server.prependListener('connection', (stream) => {
       *   console.log('someone connected!');
       * });
       * ```
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       * @param eventName The name of the event.
       * @param listener The callback function
       */
      prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Adds a **one-time**`listener` function for the event named `eventName` to the_beginning_ of the listeners array. The next time `eventName` is triggered, this
       * listener is removed, and then invoked.
       *
       * ```js
       * server.prependOnceListener('connection', (stream) => {
       *   console.log('Ah, we have our first user!');
       * });
       * ```
       *
       * Returns a reference to the `EventEmitter`, so that calls can be chained.
       * @param eventName The name of the event.
       * @param listener The callback function
       */
      prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * Returns an array listing the events for which the emitter has registered
       * listeners. The values in the array are strings or `Symbol`s.
       *
       * ```js
       * const EventEmitter = require('events');
       * const myEE = new EventEmitter();
       * myEE.on('foo', () => {});
       * myEE.on('bar', () => {});
       *
       * const sym = Symbol('symbol');
       * myEE.on(sym, () => {});
       *
       * console.log(myEE.eventNames());
       * // Prints: [ 'foo', 'bar', Symbol(symbol) ]
       * ```
       */
      eventNames(): Array<string | symbol>;
  }
  /**
   * The `EventEmitter` class is defined and exposed by the `events` module:
   *
   * ```js
   * const EventEmitter = require('events');
   * ```
   *
   * All `EventEmitter`s emit the event `'newListener'` when new listeners are
   * added and `'removeListener'` when existing listeners are removed.
   *
   * It supports the following option:
   */
  class EventEmitter {
      constructor(options?: EventEmitterOptions);
      /**
       * Creates a `Promise` that is fulfilled when the `EventEmitter` emits the given
       * event or that is rejected if the `EventEmitter` emits `'error'` while waiting.
       * The `Promise` will resolve with an array of all the arguments emitted to the
       * given event.
       *
       * This method is intentionally generic and works with the web platform [EventTarget](https://dom.spec.whatwg.org/#interface-eventtarget) interface, which has no special`'error'` event
       * semantics and does not listen to the `'error'` event.
       *
       * ```js
       * const { once, EventEmitter } = require('events');
       *
       * async function run() {
       *   const ee = new EventEmitter();
       *
       *   process.nextTick(() => {
       *     ee.emit('myevent', 42);
       *   });
       *
       *   const [value] = await once(ee, 'myevent');
       *   console.log(value);
       *
       *   const err = new Error('kaboom');
       *   process.nextTick(() => {
       *     ee.emit('error', err);
       *   });
       *
       *   try {
       *     await once(ee, 'myevent');
       *   } catch (err) {
       *     console.log('error happened', err);
       *   }
       * }
       *
       * run();
       * ```
       *
       * The special handling of the `'error'` event is only used when `events.once()`is used to wait for another event. If `events.once()` is used to wait for the
       * '`error'` event itself, then it is treated as any other kind of event without
       * special handling:
       *
       * ```js
       * const { EventEmitter, once } = require('events');
       *
       * const ee = new EventEmitter();
       *
       * once(ee, 'error')
       *   .then(([err]) => console.log('ok', err.message))
       *   .catch((err) => console.log('error', err.message));
       *
       * ee.emit('error', new Error('boom'));
       *
       * // Prints: ok boom
       * ```
       *
       * An `AbortSignal` can be used to cancel waiting for the event:
       *
       * ```js
       * const { EventEmitter, once } = require('events');
       *
       * const ee = new EventEmitter();
       * const ac = new AbortController();
       *
       * async function foo(emitter, event, signal) {
       *   try {
       *     await once(emitter, event, { signal });
       *     console.log('event emitted!');
       *   } catch (error) {
       *     if (error.name === 'AbortError') {
       *       console.error('Waiting for the event was canceled!');
       *     } else {
       *       console.error('There was an error', error.message);
       *     }
       *   }
       * }
       *
       * foo(ee, 'foo', ac.signal);
       * ac.abort(); // Abort waiting for the event
       * ee.emit('foo'); // Prints: Waiting for the event was canceled!
       * ```
       */
      static once(emitter: NodeEventTarget, eventName: string | symbol, options?: StaticEventEmitterOptions): Promise<any[]>;
      static once(emitter: DOMEventTarget, eventName: string, options?: StaticEventEmitterOptions): Promise<any[]>;
      /**
       * ```js
       * const { on, EventEmitter } = require('events');
       *
       * (async () => {
       *   const ee = new EventEmitter();
       *
       *   // Emit later on
       *   process.nextTick(() => {
       *     ee.emit('foo', 'bar');
       *     ee.emit('foo', 42);
       *   });
       *
       *   for await (const event of on(ee, 'foo')) {
       *     // The execution of this inner block is synchronous and it
       *     // processes one event at a time (even with await). Do not use
       *     // if concurrent execution is required.
       *     console.log(event); // prints ['bar'] [42]
       *   }
       *   // Unreachable here
       * })();
       * ```
       *
       * Returns an `AsyncIterator` that iterates `eventName` events. It will throw
       * if the `EventEmitter` emits `'error'`. It removes all listeners when
       * exiting the loop. The `value` returned by each iteration is an array
       * composed of the emitted event arguments.
       *
       * An `AbortSignal` can be used to cancel waiting on events:
       *
       * ```js
       * const { on, EventEmitter } = require('events');
       * const ac = new AbortController();
       *
       * (async () => {
       *   const ee = new EventEmitter();
       *
       *   // Emit later on
       *   process.nextTick(() => {
       *     ee.emit('foo', 'bar');
       *     ee.emit('foo', 42);
       *   });
       *
       *   for await (const event of on(ee, 'foo', { signal: ac.signal })) {
       *     // The execution of this inner block is synchronous and it
       *     // processes one event at a time (even with await). Do not use
       *     // if concurrent execution is required.
       *     console.log(event); // prints ['bar'] [42]
       *   }
       *   // Unreachable here
       * })();
       *
       * process.nextTick(() => ac.abort());
       * ```
       * @param eventName The name of the event being listened for
       * @return that iterates `eventName` events emitted by the `emitter`
       */
      static on(emitter: EventEmitter, eventName: string, options?: StaticEventEmitterOptions): AsyncIterableIterator<any>;
      /**
       * A class method that returns the number of listeners for the given `eventName`registered on the given `emitter`.
       *
       * ```js
       * const { EventEmitter, listenerCount } = require('events');
       * const myEmitter = new EventEmitter();
       * myEmitter.on('event', () => {});
       * myEmitter.on('event', () => {});
       * console.log(listenerCount(myEmitter, 'event'));
       * // Prints: 2
       * ```
       * @deprecated Since v3.2.0 - Use `listenerCount` instead.
       * @param emitter The emitter to query
       * @param eventName The event name
       */
      static listenerCount(emitter: EventEmitter, eventName: string | symbol): number;
      /**
       * Returns a copy of the array of listeners for the event named `eventName`.
       *
       * For `EventEmitter`s this behaves exactly the same as calling `.listeners` on
       * the emitter.
       *
       * For `EventTarget`s this is the only way to get the event listeners for the
       * event target. This is useful for debugging and diagnostic purposes.
       *
       * ```js
       * const { getEventListeners, EventEmitter } = require('events');
       *
       * {
       *   const ee = new EventEmitter();
       *   const listener = () => console.log('Events are fun');
       *   ee.on('foo', listener);
       *   getEventListeners(ee, 'foo'); // [listener]
       * }
       * {
       *   const et = new EventTarget();
       *   const listener = () => console.log('Events are fun');
       *   et.addEventListener('foo', listener);
       *   getEventListeners(et, 'foo'); // [listener]
       * }
       * ```
       */
      static getEventListeners(emitter: DOMEventTarget | EventEmitter, name: string | symbol): Function[];
      /**
       * ```js
       * const {
       *   setMaxListeners,
       *   EventEmitter
       * } = require('events');
       *
       * const target = new EventTarget();
       * const emitter = new EventEmitter();
       *
       * setMaxListeners(5, target, emitter);
       * ```
       * @param n A non-negative number. The maximum number of listeners per `EventTarget` event.
       * @param eventsTargets Zero or more {EventTarget} or {EventEmitter} instances. If none are specified, `n` is set as the default max for all newly created {EventTarget} and {EventEmitter}
       * objects.
       */
      static setMaxListeners(n?: number, ...eventTargets: Array<DOMEventTarget | EventEmitter>): void;
      /**
       * This symbol shall be used to install a listener for only monitoring `'error'`
       * events. Listeners installed using this symbol are called before the regular
       * `'error'` listeners are called.
       *
       * Installing a listener using this symbol does not change the behavior once an
       * `'error'` event is emitted, therefore the process will still crash if no
       * regular `'error'` listener is installed.
       */
      static readonly errorMonitor: unique symbol;
      static readonly captureRejectionSymbol: unique symbol;
      /**
       * Sets or gets the default captureRejection value for all emitters.
       */
      static captureRejections: boolean;
      static defaultMaxListeners: number;
  }
  import internal = require('node:events');
  namespace EventEmitter {
      // Should just be `export { EventEmitter }`, but that doesn't work in TypeScript 3.4
      export { internal as EventEmitter };
      export interface Abortable {
          /**
           * When provided the corresponding `AbortController` can be used to cancel an asynchronous action.
           */
          signal?: AbortSignal | undefined;
      }
  }
  export = EventEmitter;
}
declare module 'node:events' {
  import events = require('events');
  export = events;
}

// ./os.d.ts

/**
 * The `os` module provides operating system-related utility methods and
 * properties. It can be accessed using:
 *
 * ```js
 * const os = require('os');
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/os.js)
 */
 declare module 'os' {
  interface CpuInfo {
      model: string;
      speed: number;
      times: {
          user: number;
          nice: number;
          sys: number;
          idle: number;
          irq: number;
      };
  }
  interface NetworkInterfaceBase {
      address: string;
      netmask: string;
      mac: string;
      internal: boolean;
      cidr: string | null;
  }
  interface NetworkInterfaceInfoIPv4 extends NetworkInterfaceBase {
      family: 'IPv4';
  }
  interface NetworkInterfaceInfoIPv6 extends NetworkInterfaceBase {
      family: 'IPv6';
      scopeid: number;
  }
  interface UserInfo<T> {
      username: T;
      uid: number;
      gid: number;
      shell: T;
      homedir: T;
  }
  type NetworkInterfaceInfo = NetworkInterfaceInfoIPv4 | NetworkInterfaceInfoIPv6;
  /**
   * Returns the host name of the operating system as a string.
   */
  function hostname(): string;
  /**
   * Returns an array containing the 1, 5, and 15 minute load averages.
   *
   * The load average is a measure of system activity calculated by the operating
   * system and expressed as a fractional number.
   *
   * The load average is a Unix-specific concept. On Windows, the return value is
   * always `[0, 0, 0]`.
   */
  function loadavg(): number[];
  /**
   * Returns the system uptime in number of seconds.
   */
  function uptime(): number;
  /**
   * Returns the amount of free system memory in bytes as an integer.
   */
  function freemem(): number;
  /**
   * Returns the total amount of system memory in bytes as an integer.
   */
  function totalmem(): number;
  /**
   * Returns an array of objects containing information about each logical CPU core.
   *
   * The properties included on each object include:
   *
   * ```js
   * [
   *   {
   *     model: 'Intel(R) Core(TM) i7 CPU         860  @ 2.80GHz',
   *     speed: 2926,
   *     times: {
   *       user: 252020,
   *       nice: 0,
   *       sys: 30340,
   *       idle: 1070356870,
   *       irq: 0
   *     }
   *   },
   *   {
   *     model: 'Intel(R) Core(TM) i7 CPU         860  @ 2.80GHz',
   *     speed: 2926,
   *     times: {
   *       user: 306960,
   *       nice: 0,
   *       sys: 26980,
   *       idle: 1071569080,
   *       irq: 0
   *     }
   *   },
   *   {
   *     model: 'Intel(R) Core(TM) i7 CPU         860  @ 2.80GHz',
   *     speed: 2926,
   *     times: {
   *       user: 248450,
   *       nice: 0,
   *       sys: 21750,
   *       idle: 1070919370,
   *       irq: 0
   *     }
   *   },
   *   {
   *     model: 'Intel(R) Core(TM) i7 CPU         860  @ 2.80GHz',
   *     speed: 2926,
   *     times: {
   *       user: 256880,
   *       nice: 0,
   *       sys: 19430,
   *       idle: 1070905480,
   *       irq: 20
   *     }
   *   },
   * ]
   * ```
   *
   * `nice` values are POSIX-only. On Windows, the `nice` values of all processors
   * are always 0.
   */
  function cpus(): CpuInfo[];
  /**
   * Returns the operating system name as returned by [`uname(3)`](https://linux.die.net/man/3/uname). For example, it
   * returns `'Linux'` on Linux, `'Darwin'` on macOS, and `'Windows_NT'` on Windows.
   *
   * See [https://en.wikipedia.org/wiki/Uname#Examples](https://en.wikipedia.org/wiki/Uname#Examples) for additional information
   * about the output of running [`uname(3)`](https://linux.die.net/man/3/uname) on various operating systems.
   */
  function type(): string;
  /**
   * Returns the operating system as a string.
   *
   * On POSIX systems, the operating system release is determined by calling [`uname(3)`](https://linux.die.net/man/3/uname). On Windows, `GetVersionExW()` is used. See
   * [https://en.wikipedia.org/wiki/Uname#Examples](https://en.wikipedia.org/wiki/Uname#Examples) for more information.
   */
  function release(): string;
  /**
   * Returns an object containing network interfaces that have been assigned a
   * network address.
   *
   * Each key on the returned object identifies a network interface. The associated
   * value is an array of objects that each describe an assigned network address.
   *
   * The properties available on the assigned network address object include:
   *
   * ```js
   * {
   *   lo: [
   *     {
   *       address: '127.0.0.1',
   *       netmask: '255.0.0.0',
   *       family: 'IPv4',
   *       mac: '00:00:00:00:00:00',
   *       internal: true,
   *       cidr: '127.0.0.1/8'
   *     },
   *     {
   *       address: '::1',
   *       netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
   *       family: 'IPv6',
   *       mac: '00:00:00:00:00:00',
   *       scopeid: 0,
   *       internal: true,
   *       cidr: '::1/128'
   *     }
   *   ],
   *   eth0: [
   *     {
   *       address: '192.168.1.108',
   *       netmask: '255.255.255.0',
   *       family: 'IPv4',
   *       mac: '01:02:03:0a:0b:0c',
   *       internal: false,
   *       cidr: '192.168.1.108/24'
   *     },
   *     {
   *       address: 'fe80::a00:27ff:fe4e:66a1',
   *       netmask: 'ffff:ffff:ffff:ffff::',
   *       family: 'IPv6',
   *       mac: '01:02:03:0a:0b:0c',
   *       scopeid: 1,
   *       internal: false,
   *       cidr: 'fe80::a00:27ff:fe4e:66a1/64'
   *     }
   *   ]
   * }
   * ```
   */
  function networkInterfaces(): Dict<NetworkInterfaceInfo[]>;
  /**
   * Returns the string path of the current user's home directory.
   *
   * On POSIX, it uses the `$HOME` environment variable if defined. Otherwise it
   * uses the [effective UID](https://en.wikipedia.org/wiki/User_identifier#Effective_user_ID) to look up the user's home directory.
   *
   * On Windows, it uses the `USERPROFILE` environment variable if defined.
   * Otherwise it uses the path to the profile directory of the current user.
   */
  function homedir(): string;
  /**
   * Returns information about the currently effective user. On POSIX platforms,
   * this is typically a subset of the password file. The returned object includes
   * the `username`, `uid`, `gid`, `shell`, and `homedir`. On Windows, the `uid` and`gid` fields are `-1`, and `shell` is `null`.
   *
   * The value of `homedir` returned by `os.userInfo()` is provided by the operating
   * system. This differs from the result of `os.homedir()`, which queries
   * environment variables for the home directory before falling back to the
   * operating system response.
   *
   * Throws a `SystemError` if a user has no `username` or `homedir`.
   */
  function userInfo(options: { encoding: 'buffer' }): UserInfo<Buffer>;
  function userInfo(options?: { encoding: BufferEncoding }): UserInfo<string>;
  type SignalConstants = {
      [key in Signals]: number;
  };
  namespace constants {
      const UV_UDP_REUSEADDR: number;
      namespace signals {}
      const signals: SignalConstants;
      namespace errno {
          const E2BIG: number;
          const EACCES: number;
          const EADDRINUSE: number;
          const EADDRNOTAVAIL: number;
          const EAFNOSUPPORT: number;
          const EAGAIN: number;
          const EALREADY: number;
          const EBADF: number;
          const EBADMSG: number;
          const EBUSY: number;
          const ECANCELED: number;
          const ECHILD: number;
          const ECONNABORTED: number;
          const ECONNREFUSED: number;
          const ECONNRESET: number;
          const EDEADLK: number;
          const EDESTADDRREQ: number;
          const EDOM: number;
          const EDQUOT: number;
          const EEXIST: number;
          const EFAULT: number;
          const EFBIG: number;
          const EHOSTUNREACH: number;
          const EIDRM: number;
          const EILSEQ: number;
          const EINPROGRESS: number;
          const EINTR: number;
          const EINVAL: number;
          const EIO: number;
          const EISCONN: number;
          const EISDIR: number;
          const ELOOP: number;
          const EMFILE: number;
          const EMLINK: number;
          const EMSGSIZE: number;
          const EMULTIHOP: number;
          const ENAMETOOLONG: number;
          const ENETDOWN: number;
          const ENETRESET: number;
          const ENETUNREACH: number;
          const ENFILE: number;
          const ENOBUFS: number;
          const ENODATA: number;
          const ENODEV: number;
          const ENOENT: number;
          const ENOEXEC: number;
          const ENOLCK: number;
          const ENOLINK: number;
          const ENOMEM: number;
          const ENOMSG: number;
          const ENOPROTOOPT: number;
          const ENOSPC: number;
          const ENOSR: number;
          const ENOSTR: number;
          const ENOSYS: number;
          const ENOTCONN: number;
          const ENOTDIR: number;
          const ENOTEMPTY: number;
          const ENOTSOCK: number;
          const ENOTSUP: number;
          const ENOTTY: number;
          const ENXIO: number;
          const EOPNOTSUPP: number;
          const EOVERFLOW: number;
          const EPERM: number;
          const EPIPE: number;
          const EPROTO: number;
          const EPROTONOSUPPORT: number;
          const EPROTOTYPE: number;
          const ERANGE: number;
          const EROFS: number;
          const ESPIPE: number;
          const ESRCH: number;
          const ESTALE: number;
          const ETIME: number;
          const ETIMEDOUT: number;
          const ETXTBSY: number;
          const EWOULDBLOCK: number;
          const EXDEV: number;
          const WSAEINTR: number;
          const WSAEBADF: number;
          const WSAEACCES: number;
          const WSAEFAULT: number;
          const WSAEINVAL: number;
          const WSAEMFILE: number;
          const WSAEWOULDBLOCK: number;
          const WSAEINPROGRESS: number;
          const WSAEALREADY: number;
          const WSAENOTSOCK: number;
          const WSAEDESTADDRREQ: number;
          const WSAEMSGSIZE: number;
          const WSAEPROTOTYPE: number;
          const WSAENOPROTOOPT: number;
          const WSAEPROTONOSUPPORT: number;
          const WSAESOCKTNOSUPPORT: number;
          const WSAEOPNOTSUPP: number;
          const WSAEPFNOSUPPORT: number;
          const WSAEAFNOSUPPORT: number;
          const WSAEADDRINUSE: number;
          const WSAEADDRNOTAVAIL: number;
          const WSAENETDOWN: number;
          const WSAENETUNREACH: number;
          const WSAENETRESET: number;
          const WSAECONNABORTED: number;
          const WSAECONNRESET: number;
          const WSAENOBUFS: number;
          const WSAEISCONN: number;
          const WSAENOTCONN: number;
          const WSAESHUTDOWN: number;
          const WSAETOOMANYREFS: number;
          const WSAETIMEDOUT: number;
          const WSAECONNREFUSED: number;
          const WSAELOOP: number;
          const WSAENAMETOOLONG: number;
          const WSAEHOSTDOWN: number;
          const WSAEHOSTUNREACH: number;
          const WSAENOTEMPTY: number;
          const WSAEPROCLIM: number;
          const WSAEUSERS: number;
          const WSAEDQUOT: number;
          const WSAESTALE: number;
          const WSAEREMOTE: number;
          const WSASYSNOTREADY: number;
          const WSAVERNOTSUPPORTED: number;
          const WSANOTINITIALISED: number;
          const WSAEDISCON: number;
          const WSAENOMORE: number;
          const WSAECANCELLED: number;
          const WSAEINVALIDPROCTABLE: number;
          const WSAEINVALIDPROVIDER: number;
          const WSAEPROVIDERFAILEDINIT: number;
          const WSASYSCALLFAILURE: number;
          const WSASERVICE_NOT_FOUND: number;
          const WSATYPE_NOT_FOUND: number;
          const WSA_E_NO_MORE: number;
          const WSA_E_CANCELLED: number;
          const WSAEREFUSED: number;
      }
      namespace priority {
          const PRIORITY_LOW: number;
          const PRIORITY_BELOW_NORMAL: number;
          const PRIORITY_NORMAL: number;
          const PRIORITY_ABOVE_NORMAL: number;
          const PRIORITY_HIGH: number;
          const PRIORITY_HIGHEST: number;
      }
  }
  const devNull: string;
  const EOL: string;
  /**
   * Returns the operating system CPU architecture for which the Node.js binary was
   * compiled. Possible values are `'arm'`, `'arm64'`, `'ia32'`, `'mips'`,`'mipsel'`, `'ppc'`, `'ppc64'`, `'s390'`, `'s390x'`, and `'x64'`.
   *
   * The return value is equivalent to `process.arch`.
   */
  function arch(): string;
  /**
   * Returns a string identifying the kernel version.
   *
   * On POSIX systems, the operating system release is determined by calling [`uname(3)`](https://linux.die.net/man/3/uname). On Windows, `RtlGetVersion()` is used, and if it is not
   * available, `GetVersionExW()` will be used. See [https://en.wikipedia.org/wiki/Uname#Examples](https://en.wikipedia.org/wiki/Uname#Examples) for more information.
   */
  function version(): string;
  /**
   * Returns a string identifying the operating system platform for which
   * the Node.js binary was compiled. The value is set at compile time.
   * Possible values are `'aix'`, `'darwin'`, `'freebsd'`,`'linux'`,`'openbsd'`, `'sunos'`, and `'win32'`.
   *
   * The return value is equivalent to `process.platform`.
   */
  function platform(): Platform;
  /**
   * Returns the operating system's default directory for temporary files as a
   * string.
   */
  function tmpdir(): string;
  /**
   * Returns a string identifying the endianness of the CPU for which the Node.js
   * binary was compiled.
   *
   * Possible values are `'BE'` for big endian and `'LE'` for little endian.
   */
  function endianness(): 'BE' | 'LE';
  /**
   * Returns the scheduling priority for the process specified by `pid`. If `pid` is
   * not provided or is `0`, the priority of the current process is returned.
   * @param [pid=0] The process ID to retrieve scheduling priority for.
   */
  function getPriority(pid?: number): number;
  /**
   * Attempts to set the scheduling priority for the process specified by `pid`. If`pid` is not provided or is `0`, the process ID of the current process is used.
   *
   * The `priority` input must be an integer between `-20` (high priority) and `19`(low priority). Due to differences between Unix priority levels and Windows
   * priority classes, `priority` is mapped to one of six priority constants in`os.constants.priority`. When retrieving a process priority level, this range
   * mapping may cause the return value to be slightly different on Windows. To avoid
   * confusion, set `priority` to one of the priority constants.
   *
   * On Windows, setting priority to `PRIORITY_HIGHEST` requires elevated user
   * privileges. Otherwise the set priority will be silently reduced to`PRIORITY_HIGH`.
   * @param [pid=0] The process ID to set scheduling priority for.
   * @param priority The scheduling priority to assign to the process.
   */
  function setPriority(priority: number): void;
  function setPriority(pid: number, priority: number): void;
}
declare module 'node:os' {
  export * from 'os';
}

// ./domain.d.ts

/**
 * **This module is pending deprecation.** Once a replacement API has been
 * finalized, this module will be fully deprecated. Most developers should
 * **not** have cause to use this module. Users who absolutely must have
 * the functionality that domains provide may rely on it for the time being
 * but should expect to have to migrate to a different solution
 * in the future.
 *
 * Domains provide a way to handle multiple different IO operations as a
 * single group. If any of the event emitters or callbacks registered to a
 * domain emit an `'error'` event, or throw an error, then the domain object
 * will be notified, rather than losing the context of the error in the`process.on('uncaughtException')` handler, or causing the program to
 * exit immediately with an error code.
 * @deprecated
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/domain.js)
 */
 declare module 'domain' {
  import EventEmitter = require('node:events');
  /**
   * The `Domain` class encapsulates the functionality of routing errors and
   * uncaught exceptions to the active `Domain` object.
   *
   * To handle the errors that it catches, listen to its `'error'` event.
   */
  class Domain extends EventEmitter {
      /**
       * An array of timers and event emitters that have been explicitly added
       * to the domain.
       */
      members: Array<EventEmitter | number>;
      /**
       * The `enter()` method is plumbing used by the `run()`, `bind()`, and`intercept()` methods to set the active domain. It sets `domain.active` and`process.domain` to the domain, and implicitly
       * pushes the domain onto the domain
       * stack managed by the domain module (see {@link exit} for details on the
       * domain stack). The call to `enter()` delimits the beginning of a chain of
       * asynchronous calls and I/O operations bound to a domain.
       *
       * Calling `enter()` changes only the active domain, and does not alter the domain
       * itself. `enter()` and `exit()` can be called an arbitrary number of times on a
       * single domain.
       */
      enter(): void;
      /**
       * The `exit()` method exits the current domain, popping it off the domain stack.
       * Any time execution is going to switch to the context of a different chain of
       * asynchronous calls, it's important to ensure that the current domain is exited.
       * The call to `exit()` delimits either the end of or an interruption to the chain
       * of asynchronous calls and I/O operations bound to a domain.
       *
       * If there are multiple, nested domains bound to the current execution context,`exit()` will exit any domains nested within this domain.
       *
       * Calling `exit()` changes only the active domain, and does not alter the domain
       * itself. `enter()` and `exit()` can be called an arbitrary number of times on a
       * single domain.
       */
      exit(): void;
      /**
       * Run the supplied function in the context of the domain, implicitly
       * binding all event emitters, timers, and lowlevel requests that are
       * created in that context. Optionally, arguments can be passed to
       * the function.
       *
       * This is the most basic way to use a domain.
       *
       * ```js
       * const domain = require('domain');
       * const fs = require('fs');
       * const d = domain.create();
       * d.on('error', (er) => {
       *   console.error('Caught error!', er);
       * });
       * d.run(() => {
       *   process.nextTick(() => {
       *     setTimeout(() => { // Simulating some various async stuff
       *       fs.open('non-existent file', 'r', (er, fd) => {
       *         if (er) throw er;
       *         // proceed...
       *       });
       *     }, 100);
       *   });
       * });
       * ```
       *
       * In this example, the `d.on('error')` handler will be triggered, rather
       * than crashing the program.
       */
      run<T>(fn: (...args: any[]) => T, ...args: any[]): T;
      /**
       * Explicitly adds an emitter to the domain. If any event handlers called by
       * the emitter throw an error, or if the emitter emits an `'error'` event, it
       * will be routed to the domain's `'error'` event, just like with implicit
       * binding.
       *
       * This also works with timers that are returned from `setInterval()` and `setTimeout()`. If their callback function throws, it will be caught by
       * the domain `'error'` handler.
       *
       * If the Timer or `EventEmitter` was already bound to a domain, it is removed
       * from that one, and bound to this one instead.
       * @param emitter emitter or timer to be added to the domain
       */
      add(emitter: EventEmitter | number): void;
      /**
       * The opposite of {@link add}. Removes domain handling from the
       * specified emitter.
       * @param emitter emitter or timer to be removed from the domain
       */
      remove(emitter: EventEmitter | number): void;
      /**
       * The returned function will be a wrapper around the supplied callback
       * function. When the returned function is called, any errors that are
       * thrown will be routed to the domain's `'error'` event.
       *
       * ```js
       * const d = domain.create();
       *
       * function readSomeFile(filename, cb) {
       *   fs.readFile(filename, 'utf8', d.bind((er, data) => {
       *     // If this throws, it will also be passed to the domain.
       *     return cb(er, data ? JSON.parse(data) : null);
       *   }));
       * }
       *
       * d.on('error', (er) => {
       *   // An error occurred somewhere. If we throw it now, it will crash the program
       *   // with the normal line number and stack message.
       * });
       * ```
       * @param callback The callback function
       * @return The bound function
       */
      bind<T extends Function>(callback: T): T;
      /**
       * This method is almost identical to {@link bind}. However, in
       * addition to catching thrown errors, it will also intercept `Error` objects sent as the first argument to the function.
       *
       * In this way, the common `if (err) return callback(err);` pattern can be replaced
       * with a single error handler in a single place.
       *
       * ```js
       * const d = domain.create();
       *
       * function readSomeFile(filename, cb) {
       *   fs.readFile(filename, 'utf8', d.intercept((data) => {
       *     // Note, the first argument is never passed to the
       *     // callback since it is assumed to be the 'Error' argument
       *     // and thus intercepted by the domain.
       *
       *     // If this throws, it will also be passed to the domain
       *     // so the error-handling logic can be moved to the 'error'
       *     // event on the domain instead of being repeated throughout
       *     // the program.
       *     return cb(null, JSON.parse(data));
       *   }));
       * }
       *
       * d.on('error', (er) => {
       *   // An error occurred somewhere. If we throw it now, it will crash the program
       *   // with the normal line number and stack message.
       * });
       * ```
       * @param callback The callback function
       * @return The intercepted function
       */
      intercept<T extends Function>(callback: T): T;
  }
  function create(): Domain;
}
declare module 'node:domain' {
  export * from 'domain';
}

// ./util.d.ts

/**
 * The `util` module supports the needs of Node.js internal APIs. Many of the
 * utilities are useful for application and module developers as well. To access
 * it:
 *
 * ```js
 * const util = require('util');
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/util.js)
 */
 declare module 'util' {
  export interface InspectOptions {
      /**
       * If set to `true`, getters are going to be
       * inspected as well. If set to `'get'` only getters without setter are going
       * to be inspected. If set to `'set'` only getters having a corresponding
       * setter are going to be inspected. This might cause side effects depending on
       * the getter function.
       * @default `false`
       */
      getters?: 'get' | 'set' | boolean | undefined;
      showHidden?: boolean | undefined;
      /**
       * @default 2
       */
      depth?: number | null | undefined;
      colors?: boolean | undefined;
      customInspect?: boolean | undefined;
      showProxy?: boolean | undefined;
      maxArrayLength?: number | null | undefined;
      /**
       * Specifies the maximum number of characters to
       * include when formatting. Set to `null` or `Infinity` to show all elements.
       * Set to `0` or negative to show no characters.
       * @default 10000
       */
      maxStringLength?: number | null | undefined;
      breakLength?: number | undefined;
      /**
       * Setting this to `false` causes each object key
       * to be displayed on a new line. It will also add new lines to text that is
       * longer than `breakLength`. If set to a number, the most `n` inner elements
       * are united on a single line as long as all properties fit into
       * `breakLength`. Short array elements are also grouped together. Note that no
       * text will be reduced below 16 characters, no matter the `breakLength` size.
       * For more information, see the example below.
       * @default `true`
       */
      compact?: boolean | number | undefined;
      sorted?: boolean | ((a: string, b: string) => number) | undefined;
  }
  export type Style = 'special' | 'number' | 'bigint' | 'boolean' | 'undefined' | 'null' | 'string' | 'symbol' | 'date' | 'regexp' | 'module';
  export type CustomInspectFunction = (depth: number, options: InspectOptionsStylized) => string;
  export interface InspectOptionsStylized extends InspectOptions {
      stylize(text: string, styleType: Style): string;
  }
  /**
   * The `util.format()` method returns a formatted string using the first argument
   * as a `printf`\-like format string which can contain zero or more format
   * specifiers. Each specifier is replaced with the converted value from the
   * corresponding argument. Supported specifiers are:
   *
   * If a specifier does not have a corresponding argument, it is not replaced:
   *
   * ```js
   * util.format('%s:%s', 'foo');
   * // Returns: 'foo:%s'
   * ```
   *
   * Values that are not part of the format string are formatted using`util.inspect()` if their type is not `string`.
   *
   * If there are more arguments passed to the `util.format()` method than the
   * number of specifiers, the extra arguments are concatenated to the returned
   * string, separated by spaces:
   *
   * ```js
   * util.format('%s:%s', 'foo', 'bar', 'baz');
   * // Returns: 'foo:bar baz'
   * ```
   *
   * If the first argument does not contain a valid format specifier, `util.format()`returns a string that is the concatenation of all arguments separated by spaces:
   *
   * ```js
   * util.format(1, 2, 3);
   * // Returns: '1 2 3'
   * ```
   *
   * If only one argument is passed to `util.format()`, it is returned as it is
   * without any formatting:
   *
   * ```js
   * util.format('%% %s');
   * // Returns: '%% %s'
   * ```
   *
   * `util.format()` is a synchronous method that is intended as a debugging tool.
   * Some input values can have a significant performance overhead that can block the
   * event loop. Use this function with care and never in a hot code path.
   * @param format A `printf`-like format string.
   */
  export function format(format?: any, ...param: any[]): string;
  /**
   * This function is identical to {@link format}, except in that it takes
   * an `inspectOptions` argument which specifies options that are passed along to {@link inspect}.
   *
   * ```js
   * util.formatWithOptions({ colors: true }, 'See object %O', { foo: 42 });
   * // Returns 'See object { foo: 42 }', where `42` is colored as a number
   * // when printed to a terminal.
   * ```
   */
  // FIXME: util.formatWithOptions is typed, but is not defined in the polyfill
  // export function formatWithOptions(inspectOptions: InspectOptions, format?: any, ...param: any[]): string;
  /**
   * Returns the string name for a numeric error code that comes from a Node.js API.
   * The mapping between error codes and error names is platform-dependent.
   * See `Common System Errors` for the names of common errors.
   *
   * ```js
   * fs.access('file/that/does/not/exist', (err) => {
   *   const name = util.getSystemErrorName(err.errno);
   *   console.error(name);  // ENOENT
   * });
   * ```
   */
  // FIXME: util.getSystemErrorName is typed, but is not defined in the polyfill
  // export function getSystemErrorName(err: number): string;
  /**
   * Returns a Map of all system error codes available from the Node.js API.
   * The mapping between error codes and error names is platform-dependent.
   * See `Common System Errors` for the names of common errors.
   *
   * ```js
   * fs.access('file/that/does/not/exist', (err) => {
   *   const errorMap = util.getSystemErrorMap();
   *   const name = errorMap.get(err.errno);
   *   console.error(name);  // ENOENT
   * });
   * ```
   */
  // FIXME: util.getSystemErrorMap is typed, but is not defined in the polyfill
  // export function getSystemErrorMap(): Map<number, [string, string]>;
  /**
   * The `util.log()` method prints the given `string` to `stdout` with an included
   * timestamp.
   *
   * ```js
   * const util = require('util');
   *
   * util.log('Timestamped message.');
   * ```
   * @deprecated Since v6.0.0 - Use a third party module instead.
   */
  export function log(string: string): void;
  /**
   * Returns the `string` after replacing any surrogate code points
   * (or equivalently, any unpaired surrogate code units) with the
   * Unicode "replacement character" U+FFFD.
   */
  // FIXME: util.toUSVString is typed, but is not defined in the polyfill
  // export function toUSVString(string: string): string;
  /**
   * The `util.inspect()` method returns a string representation of `object` that is
   * intended for debugging. The output of `util.inspect` may change at any time
   * and should not be depended upon programmatically. Additional `options` may be
   * passed that alter the result.`util.inspect()` will use the constructor's name and/or `@@toStringTag` to make
   * an identifiable tag for an inspected value.
   *
   * ```js
   * class Foo {
   *   get [Symbol.toStringTag]() {
   *     return 'bar';
   *   }
   * }
   *
   * class Bar {}
   *
   * const baz = Object.create(null, { [Symbol.toStringTag]: { value: 'foo' } });
   *
   * util.inspect(new Foo()); // 'Foo [bar] {}'
   * util.inspect(new Bar()); // 'Bar {}'
   * util.inspect(baz);       // '[foo] {}'
   * ```
   *
   * Circular references point to their anchor by using a reference index:
   *
   * ```js
   * const { inspect } = require('util');
   *
   * const obj = {};
   * obj.a = [obj];
   * obj.b = {};
   * obj.b.inner = obj.b;
   * obj.b.obj = obj;
   *
   * console.log(inspect(obj));
   * // <ref *1> {
   * //   a: [ [Circular *1] ],
   * //   b: <ref *2> { inner: [Circular *2], obj: [Circular *1] }
   * // }
   * ```
   *
   * The following example inspects all properties of the `util` object:
   *
   * ```js
   * const util = require('util');
   *
   * console.log(util.inspect(util, { showHidden: true, depth: null }));
   * ```
   *
   * The following example highlights the effect of the `compact` option:
   *
   * ```js
   * const util = require('util');
   *
   * const o = {
   *   a: [1, 2, [[
   *     'Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit, sed do ' +
   *       'eiusmod \ntempor incididunt ut labore et dolore magna aliqua.',
   *     'test',
   *     'foo']], 4],
   *   b: new Map([['za', 1], ['zb', 'test']])
   * };
   * console.log(util.inspect(o, { compact: true, depth: 5, breakLength: 80 }));
   *
   * // { a:
   * //   [ 1,
   * //     2,
   * //     [ [ 'Lorem ipsum dolor sit amet,\nconsectetur [...]', // A long line
   * //           'test',
   * //           'foo' ] ],
   * //     4 ],
   * //   b: Map(2) { 'za' => 1, 'zb' => 'test' } }
   *
   * // Setting `compact` to false or an integer creates more reader friendly output.
   * console.log(util.inspect(o, { compact: false, depth: 5, breakLength: 80 }));
   *
   * // {
   * //   a: [
   * //     1,
   * //     2,
   * //     [
   * //       [
   * //         'Lorem ipsum dolor sit amet,\n' +
   * //           'consectetur adipiscing elit, sed do eiusmod \n' +
   * //           'tempor incididunt ut labore et dolore magna aliqua.',
   * //         'test',
   * //         'foo'
   * //       ]
   * //     ],
   * //     4
   * //   ],
   * //   b: Map(2) {
   * //     'za' => 1,
   * //     'zb' => 'test'
   * //   }
   * // }
   *
   * // Setting `breakLength` to e.g. 150 will print the "Lorem ipsum" text in a
   * // single line.
   * ```
   *
   * The `showHidden` option allows [`WeakMap`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap) and
   * [`WeakSet`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakSet) entries to be
   * inspected. If there are more entries than `maxArrayLength`, there is no
   * guarantee which entries are displayed. That means retrieving the same [`WeakSet`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakSet) entries twice may
   * result in different output. Furthermore, entries
   * with no remaining strong references may be garbage collected at any time.
   *
   * ```js
   * const { inspect } = require('util');
   *
   * const obj = { a: 1 };
   * const obj2 = { b: 2 };
   * const weakSet = new WeakSet([obj, obj2]);
   *
   * console.log(inspect(weakSet, { showHidden: true }));
   * // WeakSet { { a: 1 }, { b: 2 } }
   * ```
   *
   * The `sorted` option ensures that an object's property insertion order does not
   * impact the result of `util.inspect()`.
   *
   * ```js
   * const { inspect } = require('util');
   * const assert = require('assert');
   *
   * const o1 = {
   *   b: [2, 3, 1],
   *   a: '`a` comes before `b`',
   *   c: new Set([2, 3, 1])
   * };
   * console.log(inspect(o1, { sorted: true }));
   * // { a: '`a` comes before `b`', b: [ 2, 3, 1 ], c: Set(3) { 1, 2, 3 } }
   * console.log(inspect(o1, { sorted: (a, b) => b.localeCompare(a) }));
   * // { c: Set(3) { 3, 2, 1 }, b: [ 2, 3, 1 ], a: '`a` comes before `b`' }
   *
   * const o2 = {
   *   c: new Set([2, 1, 3]),
   *   a: '`a` comes before `b`',
   *   b: [2, 3, 1]
   * };
   * assert.strict.equal(
   *   inspect(o1, { sorted: true }),
   *   inspect(o2, { sorted: true })
   * );
   * ```
   *
   * The `numericSeparator` option adds an underscore every three digits to all
   * numbers.
   *
   * ```js
   * const { inspect } = require('util');
   *
   * const thousand = 1_000;
   * const million = 1_000_000;
   * const bigNumber = 123_456_789n;
   * const bigDecimal = 1_234.123_45;
   *
   * console.log(thousand, million, bigNumber, bigDecimal);
   * // 1_000 1_000_000 123_456_789n 1_234.123_45
   * ```
   *
   * `util.inspect()` is a synchronous method intended for debugging. Its maximum
   * output length is approximately 128 MB. Inputs that result in longer output will
   * be truncated.
   * @param object Any JavaScript primitive or `Object`.
   * @return The representation of `object`.
   */
  export function inspect(object: any, showHidden?: boolean, depth?: number | null, color?: boolean): string;
  export function inspect(object: any, options?: InspectOptions): string;
  export namespace inspect {
      let colors: Dict<[number, number]>;
      let styles: {
          [K in Style]: string;
      };
      let defaultOptions: InspectOptions;
      /**
       * Allows changing inspect settings from the repl.
       */
      let replDefaults: InspectOptions;
      /**
       * That can be used to declare custom inspect functions.
       */
      const custom: unique symbol;
  }
  /**
   * Alias for [`Array.isArray()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/isArray).
   *
   * Returns `true` if the given `object` is an `Array`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isArray([]);
   * // Returns: true
   * util.isArray(new Array());
   * // Returns: true
   * util.isArray({});
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Use `isArray` instead.
   */
  export function isArray(object: unknown): object is unknown[];
  /**
   * Returns `true` if the given `object` is a `RegExp`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isRegExp(/some regexp/);
   * // Returns: true
   * util.isRegExp(new RegExp('another regexp'));
   * // Returns: true
   * util.isRegExp({});
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Deprecated
   */
  export function isRegExp(object: unknown): object is RegExp;
  /**
   * Returns `true` if the given `object` is a `Date`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isDate(new Date());
   * // Returns: true
   * util.isDate(Date());
   * // false (without 'new' returns a String)
   * util.isDate({});
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Use {@link types.isDate} instead.
   */
  export function isDate(object: unknown): object is Date;
  /**
   * Returns `true` if the given `object` is an `Error`. Otherwise, returns`false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isError(new Error());
   * // Returns: true
   * util.isError(new TypeError());
   * // Returns: true
   * util.isError({ name: 'Error', message: 'an error occurred' });
   * // Returns: false
   * ```
   *
   * This method relies on `Object.prototype.toString()` behavior. It is
   * possible to obtain an incorrect result when the `object` argument manipulates`@@toStringTag`.
   *
   * ```js
   * const util = require('util');
   * const obj = { name: 'Error', message: 'an error occurred' };
   *
   * util.isError(obj);
   * // Returns: false
   * obj[Symbol.toStringTag] = 'Error';
   * util.isError(obj);
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use {@link types.isNativeError} instead.
   */
  export function isError(object: unknown): object is Error;
  /**
   * Usage of `util.inherits()` is discouraged. Please use the ES6 `class` and`extends` keywords to get language level inheritance support. Also note
   * that the two styles are [semantically incompatible](https://github.com/nodejs/node/issues/4179).
   *
   * Inherit the prototype methods from one [constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/constructor) into another. The
   * prototype of `constructor` will be set to a new object created from`superConstructor`.
   *
   * This mainly adds some input validation on top of`Object.setPrototypeOf(constructor.prototype, superConstructor.prototype)`.
   * As an additional convenience, `superConstructor` will be accessible
   * through the `constructor.super_` property.
   *
   * ```js
   * const util = require('util');
   * const EventEmitter = require('events');
   *
   * function MyStream() {
   *   EventEmitter.call(this);
   * }
   *
   * util.inherits(MyStream, EventEmitter);
   *
   * MyStream.prototype.write = function(data) {
   *   this.emit('data', data);
   * };
   *
   * const stream = new MyStream();
   *
   * console.log(stream instanceof EventEmitter); // true
   * console.log(MyStream.super_ === EventEmitter); // true
   *
   * stream.on('data', (data) => {
   *   console.log(`Received data: "${data}"`);
   * });
   * stream.write('It works!'); // Received data: "It works!"
   * ```
   *
   * ES6 example using `class` and `extends`:
   *
   * ```js
   * const EventEmitter = require('events');
   *
   * class MyStream extends EventEmitter {
   *   write(data) {
   *     this.emit('data', data);
   *   }
   * }
   *
   * const stream = new MyStream();
   *
   * stream.on('data', (data) => {
   *   console.log(`Received data: "${data}"`);
   * });
   * stream.write('With ES6');
   * ```
   * @deprecated Legacy: Use ES2015 class syntax and `extends` keyword instead.
   */
  export function inherits(constructor: unknown, superConstructor: unknown): void;
  export type DebugLoggerFunction = (msg: string, ...param: unknown[]) => void;
  export interface DebugLogger extends DebugLoggerFunction {
      enabled: boolean;
  }
  /**
   * The `util.debuglog()` method is used to create a function that conditionally
   * writes debug messages to `stderr` based on the existence of the `NODE_DEBUG`environment variable. If the `section` name appears within the value of that
   * environment variable, then the returned function operates similar to `console.error()`. If not, then the returned function is a no-op.
   *
   * ```js
   * const util = require('util');
   * const debuglog = util.debuglog('foo');
   *
   * debuglog('hello from foo [%d]', 123);
   * ```
   *
   * If this program is run with `NODE_DEBUG=foo` in the environment, then
   * it will output something like:
   *
   * ```console
   * FOO 3245: hello from foo [123]
   * ```
   *
   * where `3245` is the process id. If it is not run with that
   * environment variable set, then it will not print anything.
   *
   * The `section` supports wildcard also:
   *
   * ```js
   * const util = require('util');
   * const debuglog = util.debuglog('foo-bar');
   *
   * debuglog('hi there, it\'s foo-bar [%d]', 2333);
   * ```
   *
   * if it is run with `NODE_DEBUG=foo*` in the environment, then it will output
   * something like:
   *
   * ```console
   * FOO-BAR 3257: hi there, it's foo-bar [2333]
   * ```
   *
   * Multiple comma-separated `section` names may be specified in the `NODE_DEBUG`environment variable: `NODE_DEBUG=fs,net,tls`.
   *
   * The optional `callback` argument can be used to replace the logging function
   * with a different function that doesn't have any initialization or
   * unnecessary wrapping.
   *
   * ```js
   * const util = require('util');
   * let debuglog = util.debuglog('internals', (debug) => {
   *   // Replace with a logging function that optimizes out
   *   // testing if the section is enabled
   *   debuglog = debug;
   * });
   * ```
   * @param section A string identifying the portion of the application for which the `debuglog` function is being created.
   * @param callback A callback invoked the first time the logging function is called with a function argument that is a more optimized logging function.
   * @return The logging function
   */
  export function debuglog(section: string, callback?: (fn: DebugLoggerFunction) => void): DebugLogger;
  export const debug: typeof debuglog;
  /**
   * Returns `true` if the given `object` is a `Boolean`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isBoolean(1);
   * // Returns: false
   * util.isBoolean(0);
   * // Returns: false
   * util.isBoolean(false);
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `typeof value === 'boolean'` instead.
   */
  export function isBoolean(object: unknown): object is boolean;
  /**
   * Returns `true` if the given `object` is a `Buffer`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isBuffer({ length: 0 });
   * // Returns: false
   * util.isBuffer([]);
   * // Returns: false
   * util.isBuffer(Buffer.from('hello world'));
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `isBuffer` instead.
   */
  export function isBuffer(object: unknown): object is Buffer;
  /**
   * Returns `true` if the given `object` is a `Function`. Otherwise, returns`false`.
   *
   * ```js
   * const util = require('util');
   *
   * function Foo() {}
   * const Bar = () => {};
   *
   * util.isFunction({});
   * // Returns: false
   * util.isFunction(Foo);
   * // Returns: true
   * util.isFunction(Bar);
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `typeof value === 'function'` instead.
   */
  export function isFunction(object: unknown): boolean;
  /**
   * Returns `true` if the given `object` is strictly `null`. Otherwise, returns`false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isNull(0);
   * // Returns: false
   * util.isNull(undefined);
   * // Returns: false
   * util.isNull(null);
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `value === null` instead.
   */
  export function isNull(object: unknown): object is null;
  /**
   * Returns `true` if the given `object` is `null` or `undefined`. Otherwise,
   * returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isNullOrUndefined(0);
   * // Returns: false
   * util.isNullOrUndefined(undefined);
   * // Returns: true
   * util.isNullOrUndefined(null);
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `value === undefined || value === null` instead.
   */
  export function isNullOrUndefined(object: unknown): object is null | undefined;
  /**
   * Returns `true` if the given `object` is a `Number`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isNumber(false);
   * // Returns: false
   * util.isNumber(Infinity);
   * // Returns: true
   * util.isNumber(0);
   * // Returns: true
   * util.isNumber(NaN);
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `typeof value === 'number'` instead.
   */
  export function isNumber(object: unknown): object is number;
  /**
   * Returns `true` if the given `object` is strictly an `Object`**and** not a`Function` (even though functions are objects in JavaScript).
   * Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isObject(5);
   * // Returns: false
   * util.isObject(null);
   * // Returns: false
   * util.isObject({});
   * // Returns: true
   * util.isObject(() => {});
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Deprecated: Use `value !== null && typeof value === 'object'` instead.
   */
  export function isObject(object: unknown): boolean;
  /**
   * Returns `true` if the given `object` is a primitive type. Otherwise, returns`false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isPrimitive(5);
   * // Returns: true
   * util.isPrimitive('foo');
   * // Returns: true
   * util.isPrimitive(false);
   * // Returns: true
   * util.isPrimitive(null);
   * // Returns: true
   * util.isPrimitive(undefined);
   * // Returns: true
   * util.isPrimitive({});
   * // Returns: false
   * util.isPrimitive(() => {});
   * // Returns: false
   * util.isPrimitive(/^$/);
   * // Returns: false
   * util.isPrimitive(new Date());
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Use `(typeof value !== 'object' && typeof value !== 'function') || value === null` instead.
   */
  export function isPrimitive(object: unknown): boolean;
  /**
   * Returns `true` if the given `object` is a `string`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isString('');
   * // Returns: true
   * util.isString('foo');
   * // Returns: true
   * util.isString(String('foo'));
   * // Returns: true
   * util.isString(5);
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Use `typeof value === 'string'` instead.
   */
  export function isString(object: unknown): object is string;
  /**
   * Returns `true` if the given `object` is a `Symbol`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * util.isSymbol(5);
   * // Returns: false
   * util.isSymbol('foo');
   * // Returns: false
   * util.isSymbol(Symbol('foo'));
   * // Returns: true
   * ```
   * @deprecated Since v4.0.0 - Use `typeof value === 'symbol'` instead.
   */
  export function isSymbol(object: unknown): object is symbol;
  /**
   * Returns `true` if the given `object` is `undefined`. Otherwise, returns `false`.
   *
   * ```js
   * const util = require('util');
   *
   * const foo = undefined;
   * util.isUndefined(5);
   * // Returns: false
   * util.isUndefined(foo);
   * // Returns: true
   * util.isUndefined(null);
   * // Returns: false
   * ```
   * @deprecated Since v4.0.0 - Use `value === undefined` instead.
   */
  export function isUndefined(object: unknown): object is undefined;
  /**
   * The `util.deprecate()` method wraps `fn` (which may be a function or class) in
   * such a way that it is marked as deprecated.
   *
   * ```js
   * const util = require('util');
   *
   * exports.obsoleteFunction = util.deprecate(() => {
   *   // Do something here.
   * }, 'obsoleteFunction() is deprecated. Use newShinyFunction() instead.');
   * ```
   *
   * When called, `util.deprecate()` will return a function that will emit a`DeprecationWarning` using the `'warning'` event. The warning will
   * be emitted and printed to `stderr` the first time the returned function is
   * called. After the warning is emitted, the wrapped function is called without
   * emitting a warning.
   *
   * If the same optional `code` is supplied in multiple calls to `util.deprecate()`,
   * the warning will be emitted only once for that `code`.
   *
   * ```js
   * const util = require('util');
   *
   * const fn1 = util.deprecate(someFunction, someMessage, 'DEP0001');
   * const fn2 = util.deprecate(someOtherFunction, someOtherMessage, 'DEP0001');
   * fn1(); // Emits a deprecation warning with code DEP0001
   * fn2(); // Does not emit a deprecation warning because it has the same code
   * ```
   *
   * If either the `--no-deprecation` or `--no-warnings` command-line flags are
   * used, or if the `process.noDeprecation` property is set to `true`_prior_ to
   * the first deprecation warning, the `util.deprecate()` method does nothing.
   *
   * If the `--trace-deprecation` or `--trace-warnings` command-line flags are set,
   * or the `process.traceDeprecation` property is set to `true`, a warning and a
   * stack trace are printed to `stderr` the first time the deprecated function is
   * called.
   *
   * If the `--throw-deprecation` command-line flag is set, or the`process.throwDeprecation` property is set to `true`, then an exception will be
   * thrown when the deprecated function is called.
   *
   * The `--throw-deprecation` command-line flag and `process.throwDeprecation`property take precedence over `--trace-deprecation` and`process.traceDeprecation`.
   * @param fn The function that is being deprecated.
   * @param msg A warning message to display when the deprecated function is invoked.
   * @param code A deprecation code. See the `list of deprecated APIs` for a list of codes.
   * @return The deprecated function wrapped to emit a warning.
   */
  export function deprecate<T extends Function>(fn: T, msg: string, code?: string): T;
  /**
   * Returns `true` if there is deep strict equality between `val1` and `val2`.
   * Otherwise, returns `false`.
   *
   * See `assert.deepStrictEqual()` for more information about deep strict
   * equality.
   */
  export function isDeepStrictEqual(val1: unknown, val2: unknown): boolean;
  /**
   * Returns `str` with any ANSI escape codes removed.
   *
   * ```js
   * console.log(util.stripVTControlCharacters('\u001B[4mvalue\u001B[0m'));
   * // Prints "value"
   * ```
   */
  // FIXME: util.stripVTControlCharacters is typed, but is not defined in the polyfill
  // export function stripVTControlCharacters(str: string): string;
  /**
   * Takes an `async` function (or a function that returns a `Promise`) and returns a
   * function following the error-first callback style, i.e. taking
   * an `(err, value) => ...` callback as the last argument. In the callback, the
   * first argument will be the rejection reason (or `null` if the `Promise`resolved), and the second argument will be the resolved value.
   *
   * ```js
   * const util = require('util');
   *
   * async function fn() {
   *   return 'hello world';
   * }
   * const callbackFunction = util.callbackify(fn);
   *
   * callbackFunction((err, ret) => {
   *   if (err) throw err;
   *   console.log(ret);
   * });
   * ```
   *
   * Will print:
   *
   * ```text
   * hello world
   * ```
   *
   * The callback is executed asynchronously, and will have a limited stack trace.
   * If the callback throws, the process will emit an `'uncaughtException'` event, and if not handled will exit.
   *
   * Since `null` has a special meaning as the first argument to a callback, if a
   * wrapped function rejects a `Promise` with a falsy value as a reason, the value
   * is wrapped in an `Error` with the original value stored in a field named`reason`.
   *
   * ```js
   * function fn() {
   *   return Promise.reject(null);
   * }
   * const callbackFunction = util.callbackify(fn);
   *
   * callbackFunction((err, ret) => {
   *   // When the Promise was rejected with `null` it is wrapped with an Error and
   *   // the original value is stored in `reason`.
   *   err &#x26;&#x26; Object.hasOwn(err, 'reason') &#x26;&#x26; err.reason === null;  // true
   * });
   * ```
   * @param original An `async` function
   * @return a callback style function
   */
  export function callbackify(fn: () => Promise<void>): (callback: (err: ErrnoException) => void) => void;
  export function callbackify<TResult>(fn: () => Promise<TResult>): (callback: (err: ErrnoException, result: TResult) => void) => void;
  export function callbackify<T1>(fn: (arg1: T1) => Promise<void>): (arg1: T1, callback: (err: ErrnoException) => void) => void;
  export function callbackify<T1, TResult>(fn: (arg1: T1) => Promise<TResult>): (arg1: T1, callback: (err: ErrnoException, result: TResult) => void) => void;
  export function callbackify<T1, T2>(fn: (arg1: T1, arg2: T2) => Promise<void>): (arg1: T1, arg2: T2, callback: (err: ErrnoException) => void) => void;
  export function callbackify<T1, T2, TResult>(fn: (arg1: T1, arg2: T2) => Promise<TResult>): (arg1: T1, arg2: T2, callback: (err: ErrnoException | null, result: TResult) => void) => void;
  export function callbackify<T1, T2, T3>(fn: (arg1: T1, arg2: T2, arg3: T3) => Promise<void>): (arg1: T1, arg2: T2, arg3: T3, callback: (err: ErrnoException) => void) => void;
  export function callbackify<T1, T2, T3, TResult>(
      fn: (arg1: T1, arg2: T2, arg3: T3) => Promise<TResult>
  ): (arg1: T1, arg2: T2, arg3: T3, callback: (err: ErrnoException | null, result: TResult) => void) => void;
  export function callbackify<T1, T2, T3, T4>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4) => Promise<void>
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, callback: (err: ErrnoException) => void) => void;
  export function callbackify<T1, T2, T3, T4, TResult>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4) => Promise<TResult>
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, callback: (err: ErrnoException | null, result: TResult) => void) => void;
  export function callbackify<T1, T2, T3, T4, T5>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5) => Promise<void>
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, callback: (err: ErrnoException) => void) => void;
  export function callbackify<T1, T2, T3, T4, T5, TResult>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5) => Promise<TResult>
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, callback: (err: ErrnoException | null, result: TResult) => void) => void;
  export function callbackify<T1, T2, T3, T4, T5, T6>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, arg6: T6) => Promise<void>
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, arg6: T6, callback: (err: ErrnoException) => void) => void;
  export function callbackify<T1, T2, T3, T4, T5, T6, TResult>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, arg6: T6) => Promise<TResult>
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, arg6: T6, callback: (err: ErrnoException | null, result: TResult) => void) => void;
  export interface CustomPromisifyLegacy<TCustom extends Function> extends Function {
      __promisify__: TCustom;
  }
  export interface CustomPromisifySymbol<TCustom extends Function> extends Function {
      [promisify.custom]: TCustom;
  }
  export type CustomPromisify<TCustom extends Function> = CustomPromisifySymbol<TCustom> | CustomPromisifyLegacy<TCustom>;
  /**
   * Takes a function following the common error-first callback style, i.e. taking
   * an `(err, value) => ...` callback as the last argument, and returns a version
   * that returns promises.
   *
   * ```js
   * const util = require('util');
   * const fs = require('fs');
   *
   * const stat = util.promisify(fs.stat);
   * stat('.').then((stats) => {
   *   // Do something with `stats`
   * }).catch((error) => {
   *   // Handle the error.
   * });
   * ```
   *
   * Or, equivalently using `async function`s:
   *
   * ```js
   * const util = require('util');
   * const fs = require('fs');
   *
   * const stat = util.promisify(fs.stat);
   *
   * async function callStat() {
   *   const stats = await stat('.');
   *   console.log(`This directory is owned by ${stats.uid}`);
   * }
   * ```
   *
   * If there is an `original[util.promisify.custom]` property present, `promisify`will return its value, see `Custom promisified functions`.
   *
   * `promisify()` assumes that `original` is a function taking a callback as its
   * final argument in all cases. If `original` is not a function, `promisify()`will throw an error. If `original` is a function but its last argument is not
   * an error-first callback, it will still be passed an error-first
   * callback as its last argument.
   *
   * Using `promisify()` on class methods or other methods that use `this` may not
   * work as expected unless handled specially:
   *
   * ```js
   * const util = require('util');
   *
   * class Foo {
   *   constructor() {
   *     this.a = 42;
   *   }
   *
   *   bar(callback) {
   *     callback(null, this.a);
   *   }
   * }
   *
   * const foo = new Foo();
   *
   * const naiveBar = util.promisify(foo.bar);
   * // TypeError: Cannot read property 'a' of undefined
   * // naiveBar().then(a => console.log(a));
   *
   * naiveBar.call(foo).then((a) => console.log(a)); // '42'
   *
   * const bindBar = naiveBar.bind(foo);
   * bindBar().then((a) => console.log(a)); // '42'
   * ```
   */
  export function promisify<TCustom extends Function>(fn: CustomPromisify<TCustom>): TCustom;
  export function promisify<TResult>(fn: (callback: (err: any, result: TResult) => void) => void): () => Promise<TResult>;
  export function promisify(fn: (callback: (err?: any) => void) => void): () => Promise<void>;
  export function promisify<T1, TResult>(fn: (arg1: T1, callback: (err: any, result: TResult) => void) => void): (arg1: T1) => Promise<TResult>;
  export function promisify<T1>(fn: (arg1: T1, callback: (err?: any) => void) => void): (arg1: T1) => Promise<void>;
  export function promisify<T1, T2, TResult>(fn: (arg1: T1, arg2: T2, callback: (err: any, result: TResult) => void) => void): (arg1: T1, arg2: T2) => Promise<TResult>;
  export function promisify<T1, T2>(fn: (arg1: T1, arg2: T2, callback: (err?: any) => void) => void): (arg1: T1, arg2: T2) => Promise<void>;
  export function promisify<T1, T2, T3, TResult>(fn: (arg1: T1, arg2: T2, arg3: T3, callback: (err: any, result: TResult) => void) => void): (arg1: T1, arg2: T2, arg3: T3) => Promise<TResult>;
  export function promisify<T1, T2, T3>(fn: (arg1: T1, arg2: T2, arg3: T3, callback: (err?: any) => void) => void): (arg1: T1, arg2: T2, arg3: T3) => Promise<void>;
  export function promisify<T1, T2, T3, T4, TResult>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, callback: (err: any, result: TResult) => void) => void
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4) => Promise<TResult>;
  export function promisify<T1, T2, T3, T4>(fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, callback: (err?: any) => void) => void): (arg1: T1, arg2: T2, arg3: T3, arg4: T4) => Promise<void>;
  export function promisify<T1, T2, T3, T4, T5, TResult>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, callback: (err: any, result: TResult) => void) => void
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5) => Promise<TResult>;
  export function promisify<T1, T2, T3, T4, T5>(
      fn: (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5, callback: (err?: any) => void) => void
  ): (arg1: T1, arg2: T2, arg3: T3, arg4: T4, arg5: T5) => Promise<void>;
  export function promisify(fn: Function): Function;
  export namespace promisify {
      /**
       * That can be used to declare custom promisified variants of functions.
       */
      const custom: unique symbol;
  }
  export interface EncodeIntoResult {
      /**
       * The read Unicode code units of input.
       */
      read: number;
      /**
       * The written UTF-8 bytes of output.
       */
      written: number;
  }
}
declare module 'node:util' {
  export * from 'util';
}
declare module 'sys' {
  export * from 'util';
}
declare module 'node:sys' {
  export * from 'util';
}

// ./querystring.d.ts

/**
 * The `querystring` module provides utilities for parsing and formatting URL
 * query strings. It can be accessed using:
 *
 * ```js
 * const querystring = require('querystring');
 * ```
 *
 * The `querystring` API is considered Legacy. While it is still maintained,
 * new code should use the `URLSearchParams` API instead.
 * @deprecated Legacy
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/querystring.js)
 */
 declare module 'querystring' {
  interface StringifyOptions {
      encodeURIComponent?: ((str: string) => string) | undefined;
  }
  interface ParseOptions {
      maxKeys?: number | undefined;
      decodeURIComponent?: ((str: string) => string) | undefined;
  }
  interface ParsedUrlQuery extends Dict<string | string[]> {}
  interface ParsedUrlQueryInput extends Dict<string | number | boolean | ReadonlyArray<string> | ReadonlyArray<number> | ReadonlyArray<boolean> | null> {}
  /**
   * The `querystring.stringify()` method produces a URL query string from a
   * given `obj` by iterating through the object's "own properties".
   *
   * It serializes the following types of values passed in `obj`:[string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) |
   * [number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) |
   * [bigint](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) |
   * [boolean](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) |
   * [string\[\]](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) |
   * [number\[\]](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) |
   * [bigint\[\]](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) |
   * [boolean\[\]](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) The numeric values must be finite. Any other input values will be coerced to
   * empty strings.
   *
   * ```js
   * querystring.stringify({ foo: 'bar', baz: ['qux', 'quux'], corge: '' });
   * // Returns 'foo=bar&#x26;baz=qux&#x26;baz=quux&#x26;corge='
   *
   * querystring.stringify({ foo: 'bar', baz: 'qux' }, ';', ':');
   * // Returns 'foo:bar;baz:qux'
   * ```
   *
   * By default, characters requiring percent-encoding within the query string will
   * be encoded as UTF-8\. If an alternative encoding is required, then an alternative`encodeURIComponent` option will need to be specified:
   *
   * ```js
   * // Assuming gbkEncodeURIComponent function already exists,
   *
   * querystring.stringify({ w: '中文', foo: 'bar' }, null, null,
   *                       { encodeURIComponent: gbkEncodeURIComponent });
   * ```
   * @param obj The object to serialize into a URL query string
   * @param [sep='&'] The substring used to delimit key and value pairs in the query string.
   * @param [eq='='] . The substring used to delimit keys and values in the query string.
   */
  function stringify(obj?: ParsedUrlQueryInput, sep?: string, eq?: string, options?: StringifyOptions): string;
  /**
   * The `querystring.parse()` method parses a URL query string (`str`) into a
   * collection of key and value pairs.
   *
   * For example, the query string `'foo=bar&#x26;abc=xyz&#x26;abc=123'` is parsed into:
   *
   * ```js
   * {
   *   foo: 'bar',
   *   abc: ['xyz', '123']
   * }
   * ```
   *
   * The object returned by the `querystring.parse()` method _does not_prototypically inherit from the JavaScript `Object`. This means that typical`Object` methods such as `obj.toString()`,
   * `obj.hasOwnProperty()`, and others
   * are not defined and _will not work_.
   *
   * By default, percent-encoded characters within the query string will be assumed
   * to use UTF-8 encoding. If an alternative character encoding is used, then an
   * alternative `decodeURIComponent` option will need to be specified:
   *
   * ```js
   * // Assuming gbkDecodeURIComponent function already exists...
   *
   * querystring.parse('w=%D6%D0%CE%C4&#x26;foo=bar', null, null,
   *                   { decodeURIComponent: gbkDecodeURIComponent });
   * ```
   * @param str The URL query string to parse
   * @param [sep='&'] The substring used to delimit key and value pairs in the query string.
   * @param [eq='='] . The substring used to delimit keys and values in the query string.
   */
  function parse(str: string, sep?: string, eq?: string, options?: ParseOptions): ParsedUrlQuery;
  /**
   * The querystring.encode() function is an alias for querystring.stringify().
   */
  const encode: typeof stringify;
  /**
   * The querystring.decode() function is an alias for querystring.parse().
   */
  const decode: typeof parse;
  /**
   * The `querystring.escape()` method performs URL percent-encoding on the given`str` in a manner that is optimized for the specific requirements of URL
   * query strings.
   *
   * The `querystring.escape()` method is used by `querystring.stringify()` and is
   * generally not expected to be used directly. It is exported primarily to allow
   * application code to provide a replacement percent-encoding implementation if
   * necessary by assigning `querystring.escape` to an alternative function.
   */
  // FIXME: querystring.escape is typed, but not in the polyfill
  // function escape(str: string): string;
  /**
   * The `querystring.unescape()` method performs decoding of URL percent-encoded
   * characters on the given `str`.
   *
   * The `querystring.unescape()` method is used by `querystring.parse()` and is
   * generally not expected to be used directly. It is exported primarily to allow
   * application code to provide a replacement decoding implementation if
   * necessary by assigning `querystring.unescape` to an alternative function.
   *
   * By default, the `querystring.unescape()` method will attempt to use the
   * JavaScript built-in `decodeURIComponent()` method to decode. If that fails,
   * a safer equivalent that does not throw on malformed URLs will be used.
   */
  // FIXME: querystring.unescape is typed, but not in the polyfill
  // function unescape(str: string): string;
}
declare module 'node:querystring' {
  export * from 'querystring';
}

// ./string_decoder.d.ts

/**
 * The `string_decoder` module provides an API for decoding `Buffer` objects into
 * strings in a manner that preserves encoded multi-byte UTF-8 and UTF-16
 * characters. It can be accessed using:
 *
 * ```js
 * const { StringDecoder } = require('string_decoder');
 * ```
 *
 * The following example shows the basic use of the `StringDecoder` class.
 *
 * ```js
 * const { StringDecoder } = require('string_decoder');
 * const decoder = new StringDecoder('utf8');
 *
 * const cent = Buffer.from([0xC2, 0xA2]);
 * console.log(decoder.write(cent));
 *
 * const euro = Buffer.from([0xE2, 0x82, 0xAC]);
 * console.log(decoder.write(euro));
 * ```
 *
 * When a `Buffer` instance is written to the `StringDecoder` instance, an
 * internal buffer is used to ensure that the decoded string does not contain
 * any incomplete multibyte characters. These are held in the buffer until the
 * next call to `stringDecoder.write()` or until `stringDecoder.end()` is called.
 *
 * In the following example, the three UTF-8 encoded bytes of the European Euro
 * symbol (`€`) are written over three separate operations:
 *
 * ```js
 * const { StringDecoder } = require('string_decoder');
 * const decoder = new StringDecoder('utf8');
 *
 * decoder.write(Buffer.from([0xE2]));
 * decoder.write(Buffer.from([0x82]));
 * console.log(decoder.end(Buffer.from([0xAC])));
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/string_decoder.js)
 */
declare module 'string_decoder' {
  class StringDecoder {
      constructor(encoding?: BufferEncoding);
      /**
       * Returns a decoded string, ensuring that any incomplete multibyte characters at
       * the end of the `Buffer`, or `TypedArray`, or `DataView` are omitted from the
       * returned string and stored in an internal buffer for the next call to`stringDecoder.write()` or `stringDecoder.end()`.
       * @param buffer A `Buffer`, or `TypedArray`, or `DataView` containing the bytes to decode.
       */
      write(buffer: Buffer): string;
      /**
       * Returns any remaining input stored in the internal buffer as a string. Bytes
       * representing incomplete UTF-8 and UTF-16 characters will be replaced with
       * substitution characters appropriate for the character encoding.
       *
       * If the `buffer` argument is provided, one final call to `stringDecoder.write()`is performed before returning the remaining input.
       * After `end()` is called, the `stringDecoder` object can be reused for new input.
       * @param buffer A `Buffer`, or `TypedArray`, or `DataView` containing the bytes to decode.
       */
      end(buffer?: Buffer): string;
  }
}
declare module 'node:string_decoder' {
  export * from 'string_decoder';
}

// ./timers.d.ts

/**
 * The `timer` module exposes a global API for scheduling functions to
 * be called at some future period of time. Because the timer functions are
 * globals, there is no need to call `require('timers')` to use the API.
 *
 * The timer functions within Node.js implement a similar API as the timers API
 * provided by Web Browsers but use a different internal implementation that is
 * built around the Node.js [Event Loop](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/#setimmediate-vs-settimeout).
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/timers.js)
 */

declare module 'timers' {
  const _exported: {
    clearTimeout: typeof clearTimeout,
    clearInterval: typeof clearInterval,
    setTimeout: typeof setTimeout,
    setInterval: typeof setInterval,
  };
  export = _exported;
}
declare module 'node:timers' {
  import timers = require('timers');
  export = timers;
}

// ./stream.d.ts

/**
 * A stream is an abstract interface for working with streaming data in Node.js.
 * The `stream` module provides an API for implementing the stream interface.
 *
 * There are many stream objects provided by Node.js. For instance, a `request to an HTTP server` and `process.stdout` are both stream instances.
 *
 * Streams can be readable, writable, or both. All streams are instances of `EventEmitter`.
 *
 * To access the `stream` module:
 *
 * ```js
 * const stream = require('stream');
 * ```
 *
 * The `stream` module is useful for creating new types of stream instances. It is
 * usually not necessary to use the `stream` module to consume streams.
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/stream.js)
 */
 declare module 'stream' {
  import { EventEmitter, Abortable } from 'node:events';
  class internal extends EventEmitter {
      pipe<T extends WritableStream>(
          destination: T,
          options?: {
              end?: boolean | undefined;
          }
      ): T;
  }
  namespace internal {
      class Stream extends internal {
          constructor(opts?: ReadableOptions);
      }
      interface StreamOptions<T extends Stream> extends Abortable {
          emitClose?: boolean | undefined;
          highWaterMark?: number | undefined;
          objectMode?: boolean | undefined;
          construct?(this: T, callback: (error?: Error | null) => void): void;
          destroy?(this: T, error: Error | null, callback: (error: Error | null) => void): void;
          autoDestroy?: boolean | undefined;
      }
      interface ReadableOptions extends StreamOptions<Readable> {
          encoding?: BufferEncoding | undefined;
          read?(this: Readable, size: number): void;
      }
      class Readable<R = any> extends Stream implements ReadableStream {
          readonly locked: boolean;
          cancel(reason?: any): Promise<void>;
          getReader(): ReadableStreamDefaultReader<R>;
          pipeThrough<T>(
            transform: ReadableWritablePair<T, R>,
            options?: StreamPipeOptions
          ): ReadableStream<T>;
          pipeTo(
            destination: WritableStream<R>,
            options?: StreamPipeOptions
          ): Promise<void>;
          tee(): [ReadableStream<R>, ReadableStream<R>];
          forEach(
            callbackfn: (value: any, key: number, parent: ReadableStream<R>) => void,
            thisArg?: any
          ): void;
          /**
           * A utility method for creating Readable Streams out of iterators.
           */
          static from(iterable: Iterable<any> | AsyncIterable<any>, options?: ReadableOptions): Readable;
          /**
           * Returns whether the stream has been read from or cancelled.
           */
          static isDisturbed(stream: Readable | ReadableStream): boolean;
          /**
           * Returns whether the stream was destroyed or errored before emitting `'end'`.
           * @experimental
           */
          readonly readableAborted: boolean;
          /**
           * Is `true` if it is safe to call `readable.read()`, which means
           * the stream has not been destroyed or emitted `'error'` or `'end'`.
           */
          readable: boolean;
          /**
           * Getter for the property `encoding` of a given `Readable` stream. The `encoding`property can be set using the `readable.setEncoding()` method.
           */
          readonly readableEncoding: BufferEncoding | null;
          /**
           * Becomes `true` when `'end'` event is emitted.
           */
          readonly readableEnded: boolean;
          /**
           * This property reflects the current state of a `Readable` stream as described
           * in the `Three states` section.
           */
          readonly readableFlowing: boolean | null;
          /**
           * Returns the value of `highWaterMark` passed when creating this `Readable`.
           */
          readonly readableHighWaterMark: number;
          /**
           * This property contains the number of bytes (or objects) in the queue
           * ready to be read. The value provides introspection data regarding
           * the status of the `highWaterMark`.
           */
          readonly readableLength: number;
          /**
           * Getter for the property `objectMode` of a given `Readable` stream.
           */
          readonly readableObjectMode: boolean;
          /**
           * Is `true` after `readable.destroy()` has been called.
           */
          destroyed: boolean;
          constructor(opts?: ReadableOptions);
          _construct?(callback: (error?: Error | null) => void): void;
          _read(size: number): void;
          /**
           * The `readable.read()` method reads data out of the internal buffer and
           * returns it. If no data is available to be read, `null` is returned. By default,
           * the data is returned as a `Buffer` object unless an encoding has been
           * specified using the `readable.setEncoding()` method or the stream is operating
           * in object mode.
           *
           * The optional `size` argument specifies a specific number of bytes to read. If`size` bytes are not available to be read, `null` will be returned _unless_the stream has ended, in which
           * case all of the data remaining in the internal
           * buffer will be returned.
           *
           * If the `size` argument is not specified, all of the data contained in the
           * internal buffer will be returned.
           *
           * The `size` argument must be less than or equal to 1 GiB.
           *
           * The `readable.read()` method should only be called on `Readable` streams
           * operating in paused mode. In flowing mode, `readable.read()` is called
           * automatically until the internal buffer is fully drained.
           *
           * ```js
           * const readable = getReadableStreamSomehow();
           *
           * // 'readable' may be triggered multiple times as data is buffered in
           * readable.on('readable', () => {
           *   let chunk;
           *   console.log('Stream is readable (new data received in buffer)');
           *   // Use a loop to make sure we read all currently available data
           *   while (null !== (chunk = readable.read())) {
           *     console.log(`Read ${chunk.length} bytes of data...`);
           *   }
           * });
           *
           * // 'end' will be triggered once when there is no more data available
           * readable.on('end', () => {
           *   console.log('Reached end of stream.');
           * });
           * ```
           *
           * Each call to `readable.read()` returns a chunk of data, or `null`. The chunks
           * are not concatenated. A `while` loop is necessary to consume all data
           * currently in the buffer. When reading a large file `.read()` may return `null`,
           * having consumed all buffered content so far, but there is still more data to
           * come not yet buffered. In this case a new `'readable'` event will be emitted
           * when there is more data in the buffer. Finally the `'end'` event will be
           * emitted when there is no more data to come.
           *
           * Therefore to read a file's whole contents from a `readable`, it is necessary
           * to collect chunks across multiple `'readable'` events:
           *
           * ```js
           * const chunks = [];
           *
           * readable.on('readable', () => {
           *   let chunk;
           *   while (null !== (chunk = readable.read())) {
           *     chunks.push(chunk);
           *   }
           * });
           *
           * readable.on('end', () => {
           *   const content = chunks.join('');
           * });
           * ```
           *
           * A `Readable` stream in object mode will always return a single item from
           * a call to `readable.read(size)`, regardless of the value of the`size` argument.
           *
           * If the `readable.read()` method returns a chunk of data, a `'data'` event will
           * also be emitted.
           *
           * Calling {@link read} after the `'end'` event has
           * been emitted will return `null`. No runtime error will be raised.
           * @param size Optional argument to specify how much data to read.
           */
          read(size?: number): any;
          /**
           * The `readable.setEncoding()` method sets the character encoding for
           * data read from the `Readable` stream.
           *
           * By default, no encoding is assigned and stream data will be returned as`Buffer` objects. Setting an encoding causes the stream data
           * to be returned as strings of the specified encoding rather than as `Buffer`objects. For instance, calling `readable.setEncoding('utf8')` will cause the
           * output data to be interpreted as UTF-8 data, and passed as strings. Calling`readable.setEncoding('hex')` will cause the data to be encoded in hexadecimal
           * string format.
           *
           * The `Readable` stream will properly handle multi-byte characters delivered
           * through the stream that would otherwise become improperly decoded if simply
           * pulled from the stream as `Buffer` objects.
           *
           * ```js
           * const readable = getReadableStreamSomehow();
           * readable.setEncoding('utf8');
           * readable.on('data', (chunk) => {
           *   assert.equal(typeof chunk, 'string');
           *   console.log('Got %d characters of string data:', chunk.length);
           * });
           * ```
           * @param encoding The encoding to use.
           */
          setEncoding(encoding: BufferEncoding): this;
          /**
           * The `readable.pause()` method will cause a stream in flowing mode to stop
           * emitting `'data'` events, switching out of flowing mode. Any data that
           * becomes available will remain in the internal buffer.
           *
           * ```js
           * const readable = getReadableStreamSomehow();
           * readable.on('data', (chunk) => {
           *   console.log(`Received ${chunk.length} bytes of data.`);
           *   readable.pause();
           *   console.log('There will be no additional data for 1 second.');
           *   setTimeout(() => {
           *     console.log('Now data will start flowing again.');
           *     readable.resume();
           *   }, 1000);
           * });
           * ```
           *
           * The `readable.pause()` method has no effect if there is a `'readable'`event listener.
           */
          pause(): this;
          /**
           * The `readable.resume()` method causes an explicitly paused `Readable` stream to
           * resume emitting `'data'` events, switching the stream into flowing mode.
           *
           * The `readable.resume()` method can be used to fully consume the data from a
           * stream without actually processing any of that data:
           *
           * ```js
           * getReadableStreamSomehow()
           *   .resume()
           *   .on('end', () => {
           *     console.log('Reached the end, but did not read anything.');
           *   });
           * ```
           *
           * The `readable.resume()` method has no effect if there is a `'readable'`event listener.
           */
          resume(): this;
          /**
           * The `readable.isPaused()` method returns the current operating state of the`Readable`. This is used primarily by the mechanism that underlies the`readable.pipe()` method. In most
           * typical cases, there will be no reason to
           * use this method directly.
           *
           * ```js
           * const readable = new stream.Readable();
           *
           * readable.isPaused(); // === false
           * readable.pause();
           * readable.isPaused(); // === true
           * readable.resume();
           * readable.isPaused(); // === false
           * ```
           */
          isPaused(): boolean;
          /**
           * The `readable.unpipe()` method detaches a `Writable` stream previously attached
           * using the {@link pipe} method.
           *
           * If the `destination` is not specified, then _all_ pipes are detached.
           *
           * If the `destination` is specified, but no pipe is set up for it, then
           * the method does nothing.
           *
           * ```js
           * const fs = require('fs');
           * const readable = getReadableStreamSomehow();
           * const writable = fs.createWriteStream('file.txt');
           * // All the data from readable goes into 'file.txt',
           * // but only for the first second.
           * readable.pipe(writable);
           * setTimeout(() => {
           *   console.log('Stop writing to file.txt.');
           *   readable.unpipe(writable);
           *   console.log('Manually close the file stream.');
           *   writable.end();
           * }, 1000);
           * ```
           * @param destination Optional specific stream to unpipe
           */
          unpipe(destination?: WritableStream): this;
          /**
           * Passing `chunk` as `null` signals the end of the stream (EOF) and behaves the
           * same as `readable.push(null)`, after which no more data can be written. The EOF
           * signal is put at the end of the buffer and any buffered data will still be
           * flushed.
           *
           * The `readable.unshift()` method pushes a chunk of data back into the internal
           * buffer. This is useful in certain situations where a stream is being consumed by
           * code that needs to "un-consume" some amount of data that it has optimistically
           * pulled out of the source, so that the data can be passed on to some other party.
           *
           * The `stream.unshift(chunk)` method cannot be called after the `'end'` event
           * has been emitted or a runtime error will be thrown.
           *
           * Developers using `stream.unshift()` often should consider switching to
           * use of a `Transform` stream instead. See the `API for stream implementers` section for more information.
           *
           * ```js
           * // Pull off a header delimited by \n\n.
           * // Use unshift() if we get too much.
           * // Call the callback with (error, header, stream).
           * const { StringDecoder } = require('string_decoder');
           * function parseHeader(stream, callback) {
           *   stream.on('error', callback);
           *   stream.on('readable', onReadable);
           *   const decoder = new StringDecoder('utf8');
           *   let header = '';
           *   function onReadable() {
           *     let chunk;
           *     while (null !== (chunk = stream.read())) {
           *       const str = decoder.write(chunk);
           *       if (str.includes('\n\n')) {
           *         // Found the header boundary.
           *         const split = str.split(/\n\n/);
           *         header += split.shift();
           *         const remaining = split.join('\n\n');
           *         const buf = Buffer.from(remaining, 'utf8');
           *         stream.removeListener('error', callback);
           *         // Remove the 'readable' listener before unshifting.
           *         stream.removeListener('readable', onReadable);
           *         if (buf.length)
           *           stream.unshift(buf);
           *         // Now the body of the message can be read from the stream.
           *         callback(null, header, stream);
           *         return;
           *       }
           *       // Still reading the header.
           *       header += str;
           *     }
           *   }
           * }
           * ```
           *
           * Unlike {@link push}, `stream.unshift(chunk)` will not
           * end the reading process by resetting the internal reading state of the stream.
           * This can cause unexpected results if `readable.unshift()` is called during a
           * read (i.e. from within a {@link _read} implementation on a
           * custom stream). Following the call to `readable.unshift()` with an immediate {@link push} will reset the reading state appropriately,
           * however it is best to simply avoid calling `readable.unshift()` while in the
           * process of performing a read.
           * @param chunk Chunk of data to unshift onto the read queue. For streams not operating in object mode, `chunk` must be a string, `Buffer`, `Uint8Array` or `null`. For object mode
           * streams, `chunk` may be any JavaScript value.
           * @param encoding Encoding of string chunks. Must be a valid `Buffer` encoding, such as `'utf8'` or `'ascii'`.
           */
          unshift(chunk: any, encoding?: BufferEncoding): void;
          /**
           * Prior to Node.js 0.10, streams did not implement the entire `stream` module API
           * as it is currently defined. (See `Compatibility` for more information.)
           *
           * When using an older Node.js library that emits `'data'` events and has a {@link pause} method that is advisory only, the`readable.wrap()` method can be used to create a `Readable`
           * stream that uses
           * the old stream as its data source.
           *
           * It will rarely be necessary to use `readable.wrap()` but the method has been
           * provided as a convenience for interacting with older Node.js applications and
           * libraries.
           *
           * ```js
           * const { OldReader } = require('./old-api-module.js');
           * const { Readable } = require('stream');
           * const oreader = new OldReader();
           * const myReader = new Readable().wrap(oreader);
           *
           * myReader.on('readable', () => {
           *   myReader.read(); // etc.
           * });
           * ```
           * @param stream An "old style" readable stream
           */
          wrap(stream: ReadableStream): this;
          push(chunk: any, encoding?: BufferEncoding): boolean;
          _destroy(error: Error | null, callback: (error?: Error | null) => void): void;
          /**
           * Destroy the stream. Optionally emit an `'error'` event, and emit a `'close'`event (unless `emitClose` is set to `false`). After this call, the readable
           * stream will release any internal resources and subsequent calls to `push()`will be ignored.
           *
           * Once `destroy()` has been called any further calls will be a no-op and no
           * further errors except from `_destroy()` may be emitted as `'error'`.
           *
           * Implementors should not override this method, but instead implement `readable._destroy()`.
           * @param error Error which will be passed as payload in `'error'` event
           */
          destroy(error?: Error): this;
          /**
           * Event emitter
           * The defined events on documents including:
           * 1. close
           * 2. data
           * 3. end
           * 4. error
           * 5. pause
           * 6. readable
           * 7. resume
           */
          addListener(event: 'close', listener: () => void): this;
          addListener(event: 'data', listener: (chunk: any) => void): this;
          addListener(event: 'end', listener: () => void): this;
          addListener(event: 'error', listener: (err: Error) => void): this;
          addListener(event: 'pause', listener: () => void): this;
          addListener(event: 'readable', listener: () => void): this;
          addListener(event: 'resume', listener: () => void): this;
          addListener(event: string | symbol, listener: (...args: any[]) => void): this;
          emit(event: 'close'): boolean;
          emit(event: 'data', chunk: any): boolean;
          emit(event: 'end'): boolean;
          emit(event: 'error', err: Error): boolean;
          emit(event: 'pause'): boolean;
          emit(event: 'readable'): boolean;
          emit(event: 'resume'): boolean;
          emit(event: string | symbol, ...args: any[]): boolean;
          on(event: 'close', listener: () => void): this;
          on(event: 'data', listener: (chunk: any) => void): this;
          on(event: 'end', listener: () => void): this;
          on(event: 'error', listener: (err: Error) => void): this;
          on(event: 'pause', listener: () => void): this;
          on(event: 'readable', listener: () => void): this;
          on(event: 'resume', listener: () => void): this;
          on(event: string | symbol, listener: (...args: any[]) => void): this;
          once(event: 'close', listener: () => void): this;
          once(event: 'data', listener: (chunk: any) => void): this;
          once(event: 'end', listener: () => void): this;
          once(event: 'error', listener: (err: Error) => void): this;
          once(event: 'pause', listener: () => void): this;
          once(event: 'readable', listener: () => void): this;
          once(event: 'resume', listener: () => void): this;
          once(event: string | symbol, listener: (...args: any[]) => void): this;
          prependListener(event: 'close', listener: () => void): this;
          prependListener(event: 'data', listener: (chunk: any) => void): this;
          prependListener(event: 'end', listener: () => void): this;
          prependListener(event: 'error', listener: (err: Error) => void): this;
          prependListener(event: 'pause', listener: () => void): this;
          prependListener(event: 'readable', listener: () => void): this;
          prependListener(event: 'resume', listener: () => void): this;
          prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
          prependOnceListener(event: 'close', listener: () => void): this;
          prependOnceListener(event: 'data', listener: (chunk: any) => void): this;
          prependOnceListener(event: 'end', listener: () => void): this;
          prependOnceListener(event: 'error', listener: (err: Error) => void): this;
          prependOnceListener(event: 'pause', listener: () => void): this;
          prependOnceListener(event: 'readable', listener: () => void): this;
          prependOnceListener(event: 'resume', listener: () => void): this;
          prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
          removeListener(event: 'close', listener: () => void): this;
          removeListener(event: 'data', listener: (chunk: any) => void): this;
          removeListener(event: 'end', listener: () => void): this;
          removeListener(event: 'error', listener: (err: Error) => void): this;
          removeListener(event: 'pause', listener: () => void): this;
          removeListener(event: 'readable', listener: () => void): this;
          removeListener(event: 'resume', listener: () => void): this;
          removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
          [Symbol.asyncIterator](): AsyncIterableIterator<any>;
      }
      interface WritableOptions extends StreamOptions<Writable> {
          decodeStrings?: boolean | undefined;
          defaultEncoding?: BufferEncoding | undefined;
          write?(this: Writable, chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
          writev?(
              this: Writable,
              chunks: Array<{
                  chunk: any;
                  encoding: BufferEncoding;
              }>,
              callback: (error?: Error | null) => void
          ): void;
          final?(this: Writable, callback: (error?: Error | null) => void): void;
      }
      class Writable<W = any> extends Stream implements WritableStream {
          readonly locked: boolean;
          abort(reason?: any): Promise<void>;
          close(): Promise<void>;
          getWriter(): WritableStreamDefaultWriter<W>;
          /**
           * Is `true` if it is safe to call `writable.write()`, which means
           * the stream has not been destroyed, errored or ended.
           */
          readonly writable: boolean;
          /**
           * Is `true` after `writable.end()` has been called. This property
           * does not indicate whether the data has been flushed, for this use `writable.writableFinished` instead.
           */
          readonly writableEnded: boolean;
          /**
           * Is set to `true` immediately before the `'finish'` event is emitted.
           */
          readonly writableFinished: boolean;
          /**
           * Return the value of `highWaterMark` passed when creating this `Writable`.
           */
          readonly writableHighWaterMark: number;
          /**
           * This property contains the number of bytes (or objects) in the queue
           * ready to be written. The value provides introspection data regarding
           * the status of the `highWaterMark`.
           */
          readonly writableLength: number;
          /**
           * Getter for the property `objectMode` of a given `Writable` stream.
           */
          readonly writableObjectMode: boolean;
          /**
           * Number of times `writable.uncork()` needs to be
           * called in order to fully uncork the stream.
           */
          readonly writableCorked: number;
          /**
           * Is `true` after `writable.destroy()` has been called.
           */
          destroyed: boolean;
          constructor(opts?: WritableOptions);
          _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
          _writev?(
              chunks: Array<{
                  chunk: any;
                  encoding: BufferEncoding;
              }>,
              callback: (error?: Error | null) => void
          ): void;
          _construct?(callback: (error?: Error | null) => void): void;
          _destroy(error: Error | null, callback: (error?: Error | null) => void): void;
          _final(callback: (error?: Error | null) => void): void;
          /**
           * The `writable.write()` method writes some data to the stream, and calls the
           * supplied `callback` once the data has been fully handled. If an error
           * occurs, the `callback` will be called with the error as its
           * first argument. The `callback` is called asynchronously and before `'error'` is
           * emitted.
           *
           * The return value is `true` if the internal buffer is less than the`highWaterMark` configured when the stream was created after admitting `chunk`.
           * If `false` is returned, further attempts to write data to the stream should
           * stop until the `'drain'` event is emitted.
           *
           * While a stream is not draining, calls to `write()` will buffer `chunk`, and
           * return false. Once all currently buffered chunks are drained (accepted for
           * delivery by the operating system), the `'drain'` event will be emitted.
           * Once `write()` returns false, do not write more chunks
           * until the `'drain'` event is emitted. While calling `write()` on a stream that
           * is not draining is allowed, Node.js will buffer all written chunks until
           * maximum memory usage occurs, at which point it will abort unconditionally.
           * Even before it aborts, high memory usage will cause poor garbage collector
           * performance and high RSS (which is not typically released back to the system,
           * even after the memory is no longer required). Since TCP sockets may never
           * drain if the remote peer does not read the data, writing a socket that is
           * not draining may lead to a remotely exploitable vulnerability.
           *
           * Writing data while the stream is not draining is particularly
           * problematic for a `Transform`, because the `Transform` streams are paused
           * by default until they are piped or a `'data'` or `'readable'` event handler
           * is added.
           *
           * If the data to be written can be generated or fetched on demand, it is
           * recommended to encapsulate the logic into a `Readable` and use {@link pipe}. However, if calling `write()` is preferred, it is
           * possible to respect backpressure and avoid memory issues using the `'drain'` event:
           *
           * ```js
           * function write(data, cb) {
           *   if (!stream.write(data)) {
           *     stream.once('drain', cb);
           *   } else {
           *     process.nextTick(cb);
           *   }
           * }
           *
           * // Wait for cb to be called before doing any other write.
           * write('hello', () => {
           *   console.log('Write completed, do more writes now.');
           * });
           * ```
           *
           * A `Writable` stream in object mode will always ignore the `encoding` argument.
           * @param chunk Optional data to write. For streams not operating in object mode, `chunk` must be a string, `Buffer` or `Uint8Array`. For object mode streams, `chunk` may be any
           * JavaScript value other than `null`.
           * @param [encoding='utf8'] The encoding, if `chunk` is a string.
           * @param callback Callback for when this chunk of data is flushed.
           * @return `false` if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data; otherwise `true`.
           */
          write(chunk: any, callback?: (error: Error | null | undefined) => void): boolean;
          write(chunk: any, encoding: BufferEncoding, callback?: (error: Error | null | undefined) => void): boolean;
          /**
           * The `writable.setDefaultEncoding()` method sets the default `encoding` for a `Writable` stream.
           * @param encoding The new default encoding
           */
          setDefaultEncoding(encoding: BufferEncoding): this;
          /**
           * Calling the `writable.end()` method signals that no more data will be written
           * to the `Writable`. The optional `chunk` and `encoding` arguments allow one
           * final additional chunk of data to be written immediately before closing the
           * stream.
           *
           * Calling the {@link write} method after calling {@link end} will raise an error.
           *
           * ```js
           * // Write 'hello, ' and then end with 'world!'.
           * const fs = require('fs');
           * const file = fs.createWriteStream('example.txt');
           * file.write('hello, ');
           * file.end('world!');
           * // Writing more now is not allowed!
           * ```
           * @param chunk Optional data to write. For streams not operating in object mode, `chunk` must be a string, `Buffer` or `Uint8Array`. For object mode streams, `chunk` may be any
           * JavaScript value other than `null`.
           * @param encoding The encoding if `chunk` is a string
           * @param callback Callback for when the stream is finished.
           */
          end(cb?: () => void): this;
          end(chunk: any, cb?: () => void): this;
          end(chunk: any, encoding: BufferEncoding, cb?: () => void): this;
          /**
           * The `writable.cork()` method forces all written data to be buffered in memory.
           * The buffered data will be flushed when either the {@link uncork} or {@link end} methods are called.
           *
           * The primary intent of `writable.cork()` is to accommodate a situation in which
           * several small chunks are written to the stream in rapid succession. Instead of
           * immediately forwarding them to the underlying destination, `writable.cork()`buffers all the chunks until `writable.uncork()` is called, which will pass them
           * all to `writable._writev()`, if present. This prevents a head-of-line blocking
           * situation where data is being buffered while waiting for the first small chunk
           * to be processed. However, use of `writable.cork()` without implementing`writable._writev()` may have an adverse effect on throughput.
           *
           * See also: `writable.uncork()`, `writable._writev()`.
           */
          cork(): void;
          /**
           * The `writable.uncork()` method flushes all data buffered since {@link cork} was called.
           *
           * When using `writable.cork()` and `writable.uncork()` to manage the buffering
           * of writes to a stream, defer calls to `writable.uncork()` using`process.nextTick()`. Doing so allows batching of all`writable.write()` calls that occur within a given Node.js event
           * loop phase.
           *
           * ```js
           * stream.cork();
           * stream.write('some ');
           * stream.write('data ');
           * process.nextTick(() => stream.uncork());
           * ```
           *
           * If the `writable.cork()` method is called multiple times on a stream, the
           * same number of calls to `writable.uncork()` must be called to flush the buffered
           * data.
           *
           * ```js
           * stream.cork();
           * stream.write('some ');
           * stream.cork();
           * stream.write('data ');
           * process.nextTick(() => {
           *   stream.uncork();
           *   // The data will not be flushed until uncork() is called a second time.
           *   stream.uncork();
           * });
           * ```
           *
           * See also: `writable.cork()`.
           */
          uncork(): void;
          /**
           * Destroy the stream. Optionally emit an `'error'` event, and emit a `'close'`event (unless `emitClose` is set to `false`). After this call, the writable
           * stream has ended and subsequent calls to `write()` or `end()` will result in
           * an `ERR_STREAM_DESTROYED` error.
           * This is a destructive and immediate way to destroy a stream. Previous calls to`write()` may not have drained, and may trigger an `ERR_STREAM_DESTROYED` error.
           * Use `end()` instead of destroy if data should flush before close, or wait for
           * the `'drain'` event before destroying the stream.
           *
           * Once `destroy()` has been called any further calls will be a no-op and no
           * further errors except from `_destroy()` may be emitted as `'error'`.
           *
           * Implementors should not override this method,
           * but instead implement `writable._destroy()`.
           * @param error Optional, an error to emit with `'error'` event.
           */
          destroy(error?: Error): this;
          /**
           * Event emitter
           * The defined events on documents including:
           * 1. close
           * 2. drain
           * 3. error
           * 4. finish
           * 5. pipe
           * 6. unpipe
           */
          addListener(event: 'close', listener: () => void): this;
          addListener(event: 'drain', listener: () => void): this;
          addListener(event: 'error', listener: (err: Error) => void): this;
          addListener(event: 'finish', listener: () => void): this;
          addListener(event: 'pipe', listener: (src: Readable) => void): this;
          addListener(event: 'unpipe', listener: (src: Readable) => void): this;
          addListener(event: string | symbol, listener: (...args: any[]) => void): this;
          emit(event: 'close'): boolean;
          emit(event: 'drain'): boolean;
          emit(event: 'error', err: Error): boolean;
          emit(event: 'finish'): boolean;
          emit(event: 'pipe', src: Readable): boolean;
          emit(event: 'unpipe', src: Readable): boolean;
          emit(event: string | symbol, ...args: any[]): boolean;
          on(event: 'close', listener: () => void): this;
          on(event: 'drain', listener: () => void): this;
          on(event: 'error', listener: (err: Error) => void): this;
          on(event: 'finish', listener: () => void): this;
          on(event: 'pipe', listener: (src: Readable) => void): this;
          on(event: 'unpipe', listener: (src: Readable) => void): this;
          on(event: string | symbol, listener: (...args: any[]) => void): this;
          once(event: 'close', listener: () => void): this;
          once(event: 'drain', listener: () => void): this;
          once(event: 'error', listener: (err: Error) => void): this;
          once(event: 'finish', listener: () => void): this;
          once(event: 'pipe', listener: (src: Readable) => void): this;
          once(event: 'unpipe', listener: (src: Readable) => void): this;
          once(event: string | symbol, listener: (...args: any[]) => void): this;
          prependListener(event: 'close', listener: () => void): this;
          prependListener(event: 'drain', listener: () => void): this;
          prependListener(event: 'error', listener: (err: Error) => void): this;
          prependListener(event: 'finish', listener: () => void): this;
          prependListener(event: 'pipe', listener: (src: Readable) => void): this;
          prependListener(event: 'unpipe', listener: (src: Readable) => void): this;
          prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
          prependOnceListener(event: 'close', listener: () => void): this;
          prependOnceListener(event: 'drain', listener: () => void): this;
          prependOnceListener(event: 'error', listener: (err: Error) => void): this;
          prependOnceListener(event: 'finish', listener: () => void): this;
          prependOnceListener(event: 'pipe', listener: (src: Readable) => void): this;
          prependOnceListener(event: 'unpipe', listener: (src: Readable) => void): this;
          prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
          removeListener(event: 'close', listener: () => void): this;
          removeListener(event: 'drain', listener: () => void): this;
          removeListener(event: 'error', listener: (err: Error) => void): this;
          removeListener(event: 'finish', listener: () => void): this;
          removeListener(event: 'pipe', listener: (src: Readable) => void): this;
          removeListener(event: 'unpipe', listener: (src: Readable) => void): this;
          removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
      }
      interface DuplexOptions extends ReadableOptions, WritableOptions {
          allowHalfOpen?: boolean | undefined;
          readableObjectMode?: boolean | undefined;
          writableObjectMode?: boolean | undefined;
          readableHighWaterMark?: number | undefined;
          writableHighWaterMark?: number | undefined;
          writableCorked?: number | undefined;
          construct?(this: Duplex, callback: (error?: Error | null) => void): void;
          read?(this: Duplex, size: number): void;
          write?(this: Duplex, chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
          writev?(
              this: Duplex,
              chunks: Array<{
                  chunk: any;
                  encoding: BufferEncoding;
              }>,
              callback: (error?: Error | null) => void
          ): void;
          final?(this: Duplex, callback: (error?: Error | null) => void): void;
          destroy?(this: Duplex, error: Error | null, callback: (error: Error | null) => void): void;
      }
      /**
       * Duplex streams are streams that implement both the `Readable` and `Writable` interfaces.
       *
       * Examples of `Duplex` streams include:
       *
       * * `TCP sockets`
       * * `zlib streams`
       * * `crypto streams`
       */
      class Duplex extends Readable implements Writable {
          readonly writable: boolean;
          readonly writableEnded: boolean;
          readonly writableFinished: boolean;
          readonly writableHighWaterMark: number;
          readonly writableLength: number;
          readonly writableObjectMode: boolean;
          readonly writableCorked: number;
          /**
           * If `false` then the stream will automatically end the writable side when the
           * readable side ends. Set initially by the `allowHalfOpen` constructor option,
           * which defaults to `false`.
           *
           * This can be changed manually to change the half-open behavior of an existing`Duplex` stream instance, but must be changed before the `'end'` event is
           * emitted.
           * @since v0.9.4
           */
          allowHalfOpen: boolean;
          constructor(opts?: DuplexOptions);
          abort(reason?: any): Promise<void>;
          close(): Promise<void>;
          getWriter(): WritableStreamDefaultWriter<any>;
          /**
           * A utility method for creating duplex streams.
           *
           * - `Stream` converts writable stream into writable `Duplex` and readable stream
           *   to `Duplex`.
           * - `Blob` converts into readable `Duplex`.
           * - `string` converts into readable `Duplex`.
           * - `ArrayBuffer` converts into readable `Duplex`.
           * - `AsyncIterable` converts into a readable `Duplex`. Cannot yield `null`.
           * - `AsyncGeneratorFunction` converts into a readable/writable transform
           *   `Duplex`. Must take a source `AsyncIterable` as first parameter. Cannot yield
           *   `null`.
           * - `AsyncFunction` converts into a writable `Duplex`. Must return
           *   either `null` or `undefined`
           * - `Object ({ writable, readable })` converts `readable` and
           *   `writable` into `Stream` and then combines them into `Duplex` where the
           *   `Duplex` will write to the `writable` and read from the `readable`.
           * - `Promise` converts into readable `Duplex`. Value `null` is ignored.
           *
           * @since v16.8.0
           */
          static from(src: Stream | Blob | ArrayBuffer | string | Iterable<any> | AsyncIterable<any> | AsyncGeneratorFunction | Promise<any> | Object): Duplex;
          _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
          _writev?(
              chunks: Array<{
                  chunk: any;
                  encoding: BufferEncoding;
              }>,
              callback: (error?: Error | null) => void
          ): void;
          _destroy(error: Error | null, callback: (error: Error | null) => void): void;
          _final(callback: (error?: Error | null) => void): void;
          write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean;
          write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
          setDefaultEncoding(encoding: BufferEncoding): this;
          end(cb?: () => void): this;
          end(chunk: any, cb?: () => void): this;
          end(chunk: any, encoding?: BufferEncoding, cb?: () => void): this;
          cork(): void;
          uncork(): void;
      }
      type TransformCallback = (error?: Error | null, data?: any) => void;
      interface TransformOptions extends DuplexOptions {
          construct?(this: Transform, callback: (error?: Error | null) => void): void;
          read?(this: Transform, size: number): void;
          write?(this: Transform, chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
          writev?(
              this: Transform,
              chunks: Array<{
                  chunk: any;
                  encoding: BufferEncoding;
              }>,
              callback: (error?: Error | null) => void
          ): void;
          final?(this: Transform, callback: (error?: Error | null) => void): void;
          destroy?(this: Transform, error: Error | null, callback: (error: Error | null) => void): void;
          transform?(this: Transform, chunk: any, encoding: BufferEncoding, callback: TransformCallback): void;
          flush?(this: Transform, callback: TransformCallback): void;
      }
      /**
       * Transform streams are `Duplex` streams where the output is in some way
       * related to the input. Like all `Duplex` streams, `Transform` streams
       * implement both the `Readable` and `Writable` interfaces.
       *
       * Examples of `Transform` streams include:
       *
       * * `zlib streams`
       * * `crypto streams`
       * @since v0.9.4
       */
      class Transform extends Duplex {
          constructor(opts?: TransformOptions);
          _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void;
          _flush(callback: TransformCallback): void;
      }
      /**
       * The `stream.PassThrough` class is a trivial implementation of a `Transform` stream that simply passes the input bytes across to the output. Its purpose is
       * primarily for examples and testing, but there are some use cases where`stream.PassThrough` is useful as a building block for novel sorts of streams.
       */
      class PassThrough extends Transform {}
      /**
       * Attaches an AbortSignal to a readable or writeable stream. This lets code
       * control stream destruction using an `AbortController`.
       *
       * Calling `abort` on the `AbortController` corresponding to the passed`AbortSignal` will behave the same way as calling `.destroy(new AbortError())`on the stream.
       *
       * ```js
       * const fs = require('fs');
       *
       * const controller = new AbortController();
       * const read = addAbortSignal(
       *   controller.signal,
       *   fs.createReadStream(('object.json'))
       * );
       * // Later, abort the operation closing the stream
       * controller.abort();
       * ```
       *
       * Or using an `AbortSignal` with a readable stream as an async iterable:
       *
       * ```js
       * const controller = new AbortController();
       * setTimeout(() => controller.abort(), 10_000); // set a timeout
       * const stream = addAbortSignal(
       *   controller.signal,
       *   fs.createReadStream(('object.json'))
       * );
       * (async () => {
       *   try {
       *     for await (const chunk of stream) {
       *       await process(chunk);
       *     }
       *   } catch (e) {
       *     if (e.name === 'AbortError') {
       *       // The operation was cancelled
       *     } else {
       *       throw e;
       *     }
       *   }
       * })();
       * ```
       * @param signal A signal representing possible cancellation
       * @param stream a stream to attach a signal to
       */
      function addAbortSignal<T extends Stream>(signal: AbortSignal, stream: T): T;
      interface FinishedOptions extends Abortable {
          error?: boolean | undefined;
          readable?: boolean | undefined;
          writable?: boolean | undefined;
      }
      /**
       * A function to get notified when a stream is no longer readable, writable
       * or has experienced an error or a premature close event.
       *
       * ```js
       * const { finished } = require('stream');
       *
       * const rs = fs.createReadStream('archive.tar');
       *
       * finished(rs, (err) => {
       *   if (err) {
       *     console.error('Stream failed.', err);
       *   } else {
       *     console.log('Stream is done reading.');
       *   }
       * });
       *
       * rs.resume(); // Drain the stream.
       * ```
       *
       * Especially useful in error handling scenarios where a stream is destroyed
       * prematurely (like an aborted HTTP request), and will not emit `'end'`or `'finish'`.
       *
       * The `finished` API provides promise version:
       *
       * ```js
       * const { finished } = require('stream/promises');
       *
       * const rs = fs.createReadStream('archive.tar');
       *
       * async function run() {
       *   await finished(rs);
       *   console.log('Stream is done reading.');
       * }
       *
       * run().catch(console.error);
       * rs.resume(); // Drain the stream.
       * ```
       *
       * `stream.finished()` leaves dangling event listeners (in particular`'error'`, `'end'`, `'finish'` and `'close'`) after `callback` has been
       * invoked. The reason for this is so that unexpected `'error'` events (due to
       * incorrect stream implementations) do not cause unexpected crashes.
       * If this is unwanted behavior then the returned cleanup function needs to be
       * invoked in the callback:
       *
       * ```js
       * const cleanup = finished(rs, (err) => {
       *   cleanup();
       *   // ...
       * });
       * ```
       * @param stream A readable and/or writable stream.
       * @param callback A callback function that takes an optional error argument.
       * @return A cleanup function which removes all registered listeners.
       */
      function finished(stream: ReadableStream | WritableStream | ReadWriteStream, options: FinishedOptions, callback: (err?: ErrnoException | null) => void): () => void;
      function finished(stream: ReadableStream | WritableStream | ReadWriteStream, callback: (err?: ErrnoException | null) => void): () => void;
      namespace finished {
          function __promisify__(stream: ReadableStream | WritableStream | ReadWriteStream, options?: FinishedOptions): Promise<void>;
      }
      type PipelineSourceFunction<T> = () => Iterable<T> | AsyncIterable<T>;
      type PipelineSource<T> = Iterable<T> | AsyncIterable<T> | ReadableStream | PipelineSourceFunction<T>;
      type PipelineTransform<S extends PipelineTransformSource<any>, U> =
          | ReadWriteStream
          | ((source: S extends (...args: any[]) => Iterable<infer ST> | AsyncIterable<infer ST> ? AsyncIterable<ST> : S) => AsyncIterable<U>);
      type PipelineTransformSource<T> = PipelineSource<T> | PipelineTransform<any, T>;
      type PipelineDestinationIterableFunction<T> = (source: AsyncIterable<T>) => AsyncIterable<any>;
      type PipelineDestinationPromiseFunction<T, P> = (source: AsyncIterable<T>) => Promise<P>;
      type PipelineDestination<S extends PipelineTransformSource<any>, P> = S extends PipelineTransformSource<infer ST>
          ? WritableStream | PipelineDestinationIterableFunction<ST> | PipelineDestinationPromiseFunction<ST, P>
          : never;
      type PipelineCallback<S extends PipelineDestination<any, any>> = S extends PipelineDestinationPromiseFunction<any, infer P>
          ? (err: ErrnoException | null, value: P) => void
          : (err: ErrnoException | null) => void;
      type PipelinePromise<S extends PipelineDestination<any, any>> = S extends PipelineDestinationPromiseFunction<any, infer P> ? Promise<P> : Promise<void>;
      interface PipelineOptions {
          signal: AbortSignal;
      }
      /**
       * A module method to pipe between streams and generators forwarding errors and
       * properly cleaning up and provide a callback when the pipeline is complete.
       *
       * ```js
       * const { pipeline } = require('stream');
       * const fs = require('fs');
       * const zlib = require('zlib');
       *
       * // Use the pipeline API to easily pipe a series of streams
       * // together and get notified when the pipeline is fully done.
       *
       * // A pipeline to gzip a potentially huge tar file efficiently:
       *
       * pipeline(
       *   fs.createReadStream('archive.tar'),
       *   zlib.createGzip(),
       *   fs.createWriteStream('archive.tar.gz'),
       *   (err) => {
       *     if (err) {
       *       console.error('Pipeline failed.', err);
       *     } else {
       *       console.log('Pipeline succeeded.');
       *     }
       *   }
       * );
       * ```
       *
       * The `pipeline` API provides a promise version, which can also
       * receive an options argument as the last parameter with a`signal` `AbortSignal` property. When the signal is aborted,`destroy` will be called on the underlying pipeline, with
       * an`AbortError`.
       *
       * ```js
       * const { pipeline } = require('stream/promises');
       *
       * async function run() {
       *   await pipeline(
       *     fs.createReadStream('archive.tar'),
       *     zlib.createGzip(),
       *     fs.createWriteStream('archive.tar.gz')
       *   );
       *   console.log('Pipeline succeeded.');
       * }
       *
       * run().catch(console.error);
       * ```
       *
       * To use an `AbortSignal`, pass it inside an options object,
       * as the last argument:
       *
       * ```js
       * const { pipeline } = require('stream/promises');
       *
       * async function run() {
       *   const ac = new AbortController();
       *   const signal = ac.signal;
       *
       *   setTimeout(() => ac.abort(), 1);
       *   await pipeline(
       *     fs.createReadStream('archive.tar'),
       *     zlib.createGzip(),
       *     fs.createWriteStream('archive.tar.gz'),
       *     { signal },
       *   );
       * }
       *
       * run().catch(console.error); // AbortError
       * ```
       *
       * The `pipeline` API also supports async generators:
       *
       * ```js
       * const { pipeline } = require('stream/promises');
       * const fs = require('fs');
       *
       * async function run() {
       *   await pipeline(
       *     fs.createReadStream('lowercase.txt'),
       *     async function* (source, { signal }) {
       *       source.setEncoding('utf8');  // Work with strings rather than `Buffer`s.
       *       for await (const chunk of source) {
       *         yield await processChunk(chunk, { signal });
       *       }
       *     },
       *     fs.createWriteStream('uppercase.txt')
       *   );
       *   console.log('Pipeline succeeded.');
       * }
       *
       * run().catch(console.error);
       * ```
       *
       * Remember to handle the `signal` argument passed into the async generator.
       * Especially in the case where the async generator is the source for the
       * pipeline (i.e. first argument) or the pipeline will never complete.
       *
       * ```js
       * const { pipeline } = require('stream/promises');
       * const fs = require('fs');
       *
       * async function run() {
       *   await pipeline(
       *     async function* ({ signal }) {
       *       await someLongRunningfn({ signal });
       *       yield 'asd';
       *     },
       *     fs.createWriteStream('uppercase.txt')
       *   );
       *   console.log('Pipeline succeeded.');
       * }
       *
       * run().catch(console.error);
       * ```
       *
       * `stream.pipeline()` will call `stream.destroy(err)` on all streams except:
       *
       * * `Readable` streams which have emitted `'end'` or `'close'`.
       * * `Writable` streams which have emitted `'finish'` or `'close'`.
       *
       * `stream.pipeline()` leaves dangling event listeners on the streams
       * after the `callback` has been invoked. In the case of reuse of streams after
       * failure, this can cause event listener leaks and swallowed errors. If the last
       * stream is readable, dangling event listeners will be removed so that the last
       * stream can be consumed later.
       *
       * `stream.pipeline()` closes all the streams when an error is raised.
       * The `IncomingRequest` usage with `pipeline` could lead to an unexpected behavior
       * once it would destroy the socket without sending the expected response.
       * See the example below:
       *
       * ```js
       * const fs = require('fs');
       * const http = require('http');
       * const { pipeline } = require('stream');
       *
       * const server = http.createServer((req, res) => {
       *   const fileStream = fs.createReadStream('./fileNotExist.txt');
       *   pipeline(fileStream, res, (err) => {
       *     if (err) {
       *       console.log(err); // No such file
       *       // this message can't be sent once `pipeline` already destroyed the socket
       *       return res.end('error!!!');
       *     }
       *   });
       * });
       * ```
       * @param callback Called when the pipeline is fully done.
       */
      function pipeline<A extends PipelineSource<any>, B extends PipelineDestination<A, any>>(
          source: A,
          destination: B,
          callback?: PipelineCallback<B>
      ): B extends WritableStream ? B : WritableStream;
      function pipeline<A extends PipelineSource<any>, T1 extends PipelineTransform<A, any>, B extends PipelineDestination<T1, any>>(
          source: A,
          transform1: T1,
          destination: B,
          callback?: PipelineCallback<B>
      ): B extends WritableStream ? B : WritableStream;
      function pipeline<A extends PipelineSource<any>, T1 extends PipelineTransform<A, any>, T2 extends PipelineTransform<T1, any>, B extends PipelineDestination<T2, any>>(
          source: A,
          transform1: T1,
          transform2: T2,
          destination: B,
          callback?: PipelineCallback<B>
      ): B extends WritableStream ? B : WritableStream;
      function pipeline<
          A extends PipelineSource<any>,
          T1 extends PipelineTransform<A, any>,
          T2 extends PipelineTransform<T1, any>,
          T3 extends PipelineTransform<T2, any>,
          B extends PipelineDestination<T3, any>
      >(source: A, transform1: T1, transform2: T2, transform3: T3, destination: B, callback?: PipelineCallback<B>): B extends WritableStream ? B : WritableStream;
      function pipeline<
          A extends PipelineSource<any>,
          T1 extends PipelineTransform<A, any>,
          T2 extends PipelineTransform<T1, any>,
          T3 extends PipelineTransform<T2, any>,
          T4 extends PipelineTransform<T3, any>,
          B extends PipelineDestination<T4, any>
      >(source: A, transform1: T1, transform2: T2, transform3: T3, transform4: T4, destination: B, callback?: PipelineCallback<B>): B extends WritableStream ? B : WritableStream;
      function pipeline(
          streams: ReadonlyArray<ReadableStream | WritableStream | ReadWriteStream>,
          callback?: (err: ErrnoException | null) => void
      ): WritableStream;
      function pipeline(
          stream1: ReadableStream,
          stream2: ReadWriteStream | WritableStream,
          ...streams: Array<ReadWriteStream | WritableStream | ((err: ErrnoException | null) => void)>
      ): WritableStream;
      namespace pipeline {
          function __promisify__<A extends PipelineSource<any>, B extends PipelineDestination<A, any>>(source: A, destination: B, options?: PipelineOptions): PipelinePromise<B>;
          function __promisify__<A extends PipelineSource<any>, T1 extends PipelineTransform<A, any>, B extends PipelineDestination<T1, any>>(
              source: A,
              transform1: T1,
              destination: B,
              options?: PipelineOptions
          ): PipelinePromise<B>;
          function __promisify__<A extends PipelineSource<any>, T1 extends PipelineTransform<A, any>, T2 extends PipelineTransform<T1, any>, B extends PipelineDestination<T2, any>>(
              source: A,
              transform1: T1,
              transform2: T2,
              destination: B,
              options?: PipelineOptions
          ): PipelinePromise<B>;
          function __promisify__<
              A extends PipelineSource<any>,
              T1 extends PipelineTransform<A, any>,
              T2 extends PipelineTransform<T1, any>,
              T3 extends PipelineTransform<T2, any>,
              B extends PipelineDestination<T3, any>
          >(source: A, transform1: T1, transform2: T2, transform3: T3, destination: B, options?: PipelineOptions): PipelinePromise<B>;
          function __promisify__<
              A extends PipelineSource<any>,
              T1 extends PipelineTransform<A, any>,
              T2 extends PipelineTransform<T1, any>,
              T3 extends PipelineTransform<T2, any>,
              T4 extends PipelineTransform<T3, any>,
              B extends PipelineDestination<T4, any>
          >(source: A, transform1: T1, transform2: T2, transform3: T3, transform4: T4, destination: B, options?: PipelineOptions): PipelinePromise<B>;
          function __promisify__(streams: ReadonlyArray<ReadableStream | WritableStream | ReadWriteStream>, options?: PipelineOptions): Promise<void>;
          function __promisify__(
              stream1: ReadableStream,
              stream2: ReadWriteStream | WritableStream,
              ...streams: Array<ReadWriteStream | WritableStream | PipelineOptions>
          ): Promise<void>;
      }
      interface Pipe {
          close(): void;
          hasRef(): boolean;
          ref(): void;
          unref(): void;
      }

      /**
       * Returns whether the stream has encountered an error.
       */
      function isErrored(stream: Readable | Writable | ReadableStream | WritableStream): boolean;

      /**
       * Returns whether the stream is readable.
       */
      function isReadable(stream: Readable | ReadableStream): boolean;
  }
  export = internal;
}
declare module 'node:stream' {
  import stream = require('stream');
  export = stream;
}

// ./crypto.d.ts

/**
 * The `crypto` module provides cryptographic functionality that includes a set of
 * wrappers for OpenSSL's hash, HMAC, cipher, decipher, sign, and verify functions.
 *
 * ```js
 * const { createHmac } = await import('crypto');
 *
 * const secret = 'abcdefg';
 * const hash = createHmac('sha256', secret)
 *                .update('I love cupcakes')
 *                .digest('hex');
 * console.log(hash);
 * // Prints:
 * //   c0fa1bc00531bd78ef38c628449c5102aeabd49b5dc3a2a516ea6ea959d6658e
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/crypto.js)
 */
 declare module 'crypto' {
  import * as stream from 'node:stream';
  /**
   * SPKAC is a Certificate Signing Request mechanism originally implemented by
   * Netscape and was specified formally as part of [HTML5's `keygen` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/keygen).
   *
   * `<keygen>` is deprecated since [HTML 5.2](https://www.w3.org/TR/html52/changes.html#features-removed) and new projects
   * should not use this element anymore.
   *
   * The `crypto` module provides the `Certificate` class for working with SPKAC
   * data. The most common usage is handling output generated by the HTML5`<keygen>` element. Node.js uses [OpenSSL's SPKAC
   * implementation](https://www.openssl.org/docs/man1.1.0/apps/openssl-spkac.html) internally.
   */
  class Certificate {
      /**
       * ```js
       * const { Certificate } = await import('crypto');
       * const spkac = getSpkacSomehow();
       * const challenge = Certificate.exportChallenge(spkac);
       * console.log(challenge.toString('utf8'));
       * // Prints: the challenge as a UTF8 string
       * ```
       * @param encoding The `encoding` of the `spkac` string.
       * @return The challenge component of the `spkac` data structure, which includes a public key and a challenge.
       */
      static exportChallenge(spkac: BinaryLike): Buffer;
      /**
       * ```js
       * const { Certificate } = await import('crypto');
       * const spkac = getSpkacSomehow();
       * const publicKey = Certificate.exportPublicKey(spkac);
       * console.log(publicKey);
       * // Prints: the public key as <Buffer ...>
       * ```
       * @param encoding The `encoding` of the `spkac` string.
       * @return The public key component of the `spkac` data structure, which includes a public key and a challenge.
       */
      static exportPublicKey(spkac: BinaryLike, encoding?: string): Buffer;
      /**
       * ```js
       * import { Buffer } from 'buffer';
       * const { Certificate } = await import('crypto');
       *
       * const spkac = getSpkacSomehow();
       * console.log(Certificate.verifySpkac(Buffer.from(spkac)));
       * // Prints: true or false
       * ```
       * @param encoding The `encoding` of the `spkac` string.
       * @return `true` if the given `spkac` data structure is valid, `false` otherwise.
       */
      static verifySpkac(spkac: ArrayBufferView): boolean;
      /**
       * @deprecated
       * @param spkac
       * @returns The challenge component of the `spkac` data structure,
       * which includes a public key and a challenge.
       */
      exportChallenge(spkac: BinaryLike): Buffer;
      /**
       * @deprecated
       * @param spkac
       * @param encoding The encoding of the spkac string.
       * @returns The public key component of the `spkac` data structure,
       * which includes a public key and a challenge.
       */
      exportPublicKey(spkac: BinaryLike, encoding?: string): Buffer;
      /**
       * @deprecated
       * @param spkac
       * @returns `true` if the given `spkac` data structure is valid,
       * `false` otherwise.
       */
      verifySpkac(spkac: ArrayBufferView): boolean;
  }
  namespace constants {
      // https://nodejs.org/dist/latest-v10.x/docs/api/crypto.html#crypto_crypto_constants
      const OPENSSL_VERSION_NUMBER: number;
      /** Applies multiple bug workarounds within OpenSSL. See https://www.openssl.org/docs/man1.0.2/ssl/SSL_CTX_set_options.html for detail. */
      const SSL_OP_ALL: number;
      /** Allows legacy insecure renegotiation between OpenSSL and unpatched clients or servers. See https://www.openssl.org/docs/man1.0.2/ssl/SSL_CTX_set_options.html. */
      const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: number;
      /** Attempts to use the server's preferences instead of the client's when selecting a cipher. See https://www.openssl.org/docs/man1.0.2/ssl/SSL_CTX_set_options.html. */
      const SSL_OP_CIPHER_SERVER_PREFERENCE: number;
      /** Instructs OpenSSL to use Cisco's "speshul" version of DTLS_BAD_VER. */
      const SSL_OP_CISCO_ANYCONNECT: number;
      /** Instructs OpenSSL to turn on cookie exchange. */
      const SSL_OP_COOKIE_EXCHANGE: number;
      /** Instructs OpenSSL to add server-hello extension from an early version of the cryptopro draft. */
      const SSL_OP_CRYPTOPRO_TLSEXT_BUG: number;
      /** Instructs OpenSSL to disable a SSL 3.0/TLS 1.0 vulnerability workaround added in OpenSSL 0.9.6d. */
      const SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: number;
      /** Instructs OpenSSL to always use the tmp_rsa key when performing RSA operations. */
      const SSL_OP_EPHEMERAL_RSA: number;
      /** Allows initial connection to servers that do not support RI. */
      const SSL_OP_LEGACY_SERVER_CONNECT: number;
      const SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: number;
      const SSL_OP_MICROSOFT_SESS_ID_BUG: number;
      /** Instructs OpenSSL to disable the workaround for a man-in-the-middle protocol-version vulnerability in the SSL 2.0 server implementation. */
      const SSL_OP_MSIE_SSLV2_RSA_PADDING: number;
      const SSL_OP_NETSCAPE_CA_DN_BUG: number;
      const SSL_OP_NETSCAPE_CHALLENGE_BUG: number;
      const SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: number;
      const SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: number;
      /** Instructs OpenSSL to disable support for SSL/TLS compression. */
      const SSL_OP_NO_COMPRESSION: number;
      const SSL_OP_NO_QUERY_MTU: number;
      /** Instructs OpenSSL to always start a new session when performing renegotiation. */
      const SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: number;
      const SSL_OP_NO_SSLv2: number;
      const SSL_OP_NO_SSLv3: number;
      const SSL_OP_NO_TICKET: number;
      const SSL_OP_NO_TLSv1: number;
      const SSL_OP_NO_TLSv1_1: number;
      const SSL_OP_NO_TLSv1_2: number;
      const SSL_OP_PKCS1_CHECK_1: number;
      const SSL_OP_PKCS1_CHECK_2: number;
      /** Instructs OpenSSL to always create a new key when using temporary/ephemeral DH parameters. */
      const SSL_OP_SINGLE_DH_USE: number;
      /** Instructs OpenSSL to always create a new key when using temporary/ephemeral ECDH parameters. */
      const SSL_OP_SINGLE_ECDH_USE: number;
      const SSL_OP_SSLEAY_080_CLIENT_DH_BUG: number;
      const SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: number;
      const SSL_OP_TLS_BLOCK_PADDING_BUG: number;
      const SSL_OP_TLS_D5_BUG: number;
      /** Instructs OpenSSL to disable version rollback attack detection. */
      const SSL_OP_TLS_ROLLBACK_BUG: number;
      const ENGINE_METHOD_RSA: number;
      const ENGINE_METHOD_DSA: number;
      const ENGINE_METHOD_DH: number;
      const ENGINE_METHOD_RAND: number;
      const ENGINE_METHOD_EC: number;
      const ENGINE_METHOD_CIPHERS: number;
      const ENGINE_METHOD_DIGESTS: number;
      const ENGINE_METHOD_PKEY_METHS: number;
      const ENGINE_METHOD_PKEY_ASN1_METHS: number;
      const ENGINE_METHOD_ALL: number;
      const ENGINE_METHOD_NONE: number;
      const DH_CHECK_P_NOT_SAFE_PRIME: number;
      const DH_CHECK_P_NOT_PRIME: number;
      const DH_UNABLE_TO_CHECK_GENERATOR: number;
      const DH_NOT_SUITABLE_GENERATOR: number;
      const ALPN_ENABLED: number;
      const RSA_PKCS1_PADDING: number;
      const RSA_SSLV23_PADDING: number;
      const RSA_NO_PADDING: number;
      const RSA_PKCS1_OAEP_PADDING: number;
      const RSA_X931_PADDING: number;
      const RSA_PKCS1_PSS_PADDING: number;
      /** Sets the salt length for RSA_PKCS1_PSS_PADDING to the digest size when signing or verifying. */
      const RSA_PSS_SALTLEN_DIGEST: number;
      /** Sets the salt length for RSA_PKCS1_PSS_PADDING to the maximum permissible value when signing data. */
      const RSA_PSS_SALTLEN_MAX_SIGN: number;
      /** Causes the salt length for RSA_PKCS1_PSS_PADDING to be determined automatically when verifying a signature. */
      const RSA_PSS_SALTLEN_AUTO: number;
      const POINT_CONVERSION_COMPRESSED: number;
      const POINT_CONVERSION_UNCOMPRESSED: number;
      const POINT_CONVERSION_HYBRID: number;
      /** Specifies the built-in default cipher list used by Node.js (colon-separated values). */
      const defaultCoreCipherList: string;
      /** Specifies the active default cipher list used by the current Node.js process  (colon-separated values). */
      const defaultCipherList: string;
  }
  interface HashOptions extends stream.TransformOptions {
      /**
       * For XOF hash functions such as `shake256`, the
       * outputLength option can be used to specify the desired output length in bytes.
       */
      outputLength?: number | undefined;
  }
  /** @deprecated since v10.0.0 */
  const fips: boolean;
  /**
   * Creates and returns a `Hash` object that can be used to generate hash digests
   * using the given `algorithm`. Optional `options` argument controls stream
   * behavior. For XOF hash functions such as `'shake256'`, the `outputLength` option
   * can be used to specify the desired output length in bytes.
   *
   * The `algorithm` is dependent on the available algorithms supported by the
   * version of OpenSSL on the platform. Examples are `'sha256'`, `'sha512'`, etc.
   * On recent releases of OpenSSL, `openssl list -digest-algorithms` will
   * display the available digest algorithms.
   *
   * Example: generating the sha256 sum of a file
   *
   * ```js
   * import {
   *   createReadStream
   * } from 'fs';
   * import { argv } from 'process';
   * const {
   *   createHash
   * } = await import('crypto');
   *
   * const filename = argv[2];
   *
   * const hash = createHash('sha256');
   *
   * const input = createReadStream(filename);
   * input.on('readable', () => {
   *   // Only one element is going to be produced by the
   *   // hash stream.
   *   const data = input.read();
   *   if (data)
   *     hash.update(data);
   *   else {
   *     console.log(`${hash.digest('hex')} ${filename}`);
   *   }
   * });
   * ```
   * @param options `stream.transform` options
   */
  function createHash(algorithm: string, options?: HashOptions): Hash;
  /**
   * Creates and returns an `Hmac` object that uses the given `algorithm` and `key`.
   * Optional `options` argument controls stream behavior.
   *
   * The `algorithm` is dependent on the available algorithms supported by the
   * version of OpenSSL on the platform. Examples are `'sha256'`, `'sha512'`, etc.
   * On recent releases of OpenSSL, `openssl list -digest-algorithms` will
   * display the available digest algorithms.
   *
   * The `key` is the HMAC key used to generate the cryptographic HMAC hash. If it is
   * a `KeyObject`, its type must be `secret`.
   *
   * Example: generating the sha256 HMAC of a file
   *
   * ```js
   * import {
   *   createReadStream
   * } from 'fs';
   * import { argv } from 'process';
   * const {
   *   createHmac
   * } = await import('crypto');
   *
   * const filename = argv[2];
   *
   * const hmac = createHmac('sha256', 'a secret');
   *
   * const input = createReadStream(filename);
   * input.on('readable', () => {
   *   // Only one element is going to be produced by the
   *   // hash stream.
   *   const data = input.read();
   *   if (data)
   *     hmac.update(data);
   *   else {
   *     console.log(`${hmac.digest('hex')} ${filename}`);
   *   }
   * });
   * ```
   * @param options `stream.transform` options
   */
  function createHmac(algorithm: string, key: BinaryLike | KeyObject, options?: stream.TransformOptions): Hmac;
  // https://nodejs.org/api/buffer.html#buffer_buffers_and_character_encodings
  type BinaryToTextEncoding = 'base64' | 'base64url' | 'hex' | 'binary';
  type CharacterEncoding = 'utf8' | 'utf-8' | 'utf16le' | 'latin1';
  type LegacyCharacterEncoding = 'ascii' | 'binary' | 'ucs2' | 'ucs-2';
  type Encoding = BinaryToTextEncoding | CharacterEncoding | LegacyCharacterEncoding;
  type ECDHKeyFormat = 'compressed' | 'uncompressed' | 'hybrid';
  /**
   * The `Hash` class is a utility for creating hash digests of data. It can be
   * used in one of two ways:
   *
   * * As a `stream` that is both readable and writable, where data is written
   * to produce a computed hash digest on the readable side, or
   * * Using the `hash.update()` and `hash.digest()` methods to produce the
   * computed hash.
   *
   * The {@link createHash} method is used to create `Hash` instances. `Hash`objects are not to be created directly using the `new` keyword.
   *
   * Example: Using `Hash` objects as streams:
   *
   * ```js
   * const {
   *   createHash
   * } = await import('crypto');
   *
   * const hash = createHash('sha256');
   *
   * hash.on('readable', () => {
   *   // Only one element is going to be produced by the
   *   // hash stream.
   *   const data = hash.read();
   *   if (data) {
   *     console.log(data.toString('hex'));
   *     // Prints:
   *     //   6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50
   *   }
   * });
   *
   * hash.write('some data to hash');
   * hash.end();
   * ```
   *
   * Example: Using `Hash` and piped streams:
   *
   * ```js
   * import { createReadStream } from 'fs';
   * import { stdout } from 'process';
   * const { createHash } = await import('crypto');
   *
   * const hash = createHash('sha256');
   *
   * const input = createReadStream('test.js');
   * input.pipe(hash).setEncoding('hex').pipe(stdout);
   * ```
   *
   * Example: Using the `hash.update()` and `hash.digest()` methods:
   *
   * ```js
   * const {
   *   createHash
   * } = await import('crypto');
   *
   * const hash = createHash('sha256');
   *
   * hash.update('some data to hash');
   * console.log(hash.digest('hex'));
   * // Prints:
   * //   6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50
   * ```
   */
  class Hash extends stream.Transform {
      private constructor();
      /**
       * Creates a new `Hash` object that contains a deep copy of the internal state
       * of the current `Hash` object.
       *
       * The optional `options` argument controls stream behavior. For XOF hash
       * functions such as `'shake256'`, the `outputLength` option can be used to
       * specify the desired output length in bytes.
       *
       * An error is thrown when an attempt is made to copy the `Hash` object after
       * its `hash.digest()` method has been called.
       *
       * ```js
       * // Calculate a rolling hash.
       * const {
       *   createHash
       * } = await import('crypto');
       *
       * const hash = createHash('sha256');
       *
       * hash.update('one');
       * console.log(hash.copy().digest('hex'));
       *
       * hash.update('two');
       * console.log(hash.copy().digest('hex'));
       *
       * hash.update('three');
       * console.log(hash.copy().digest('hex'));
       *
       * // Etc.
       * ```
       * @param options `stream.transform` options
       */
      copy(options?: stream.TransformOptions): Hash;
      /**
       * Updates the hash content with the given `data`, the encoding of which
       * is given in `inputEncoding`.
       * If `encoding` is not provided, and the `data` is a string, an
       * encoding of `'utf8'` is enforced. If `data` is a `Buffer`, `TypedArray`, or`DataView`, then `inputEncoding` is ignored.
       *
       * This can be called many times with new data as it is streamed.
       * @param inputEncoding The `encoding` of the `data` string.
       */
      update(data: BinaryLike): Hash;
      update(data: string, inputEncoding: Encoding): Hash;
      /**
       * Calculates the digest of all of the data passed to be hashed (using the `hash.update()` method).
       * If `encoding` is provided a string will be returned; otherwise
       * a `Buffer` is returned.
       *
       * The `Hash` object can not be used again after `hash.digest()` method has been
       * called. Multiple calls will cause an error to be thrown.
       * @param encoding The `encoding` of the return value.
       */
      digest(): Buffer;
      digest(encoding: BinaryToTextEncoding): string;
  }
  /**
   * The `Hmac` class is a utility for creating cryptographic HMAC digests. It can
   * be used in one of two ways:
   *
   * * As a `stream` that is both readable and writable, where data is written
   * to produce a computed HMAC digest on the readable side, or
   * * Using the `hmac.update()` and `hmac.digest()` methods to produce the
   * computed HMAC digest.
   *
   * The {@link createHmac} method is used to create `Hmac` instances. `Hmac`objects are not to be created directly using the `new` keyword.
   *
   * Example: Using `Hmac` objects as streams:
   *
   * ```js
   * const {
   *   createHmac
   * } = await import('crypto');
   *
   * const hmac = createHmac('sha256', 'a secret');
   *
   * hmac.on('readable', () => {
   *   // Only one element is going to be produced by the
   *   // hash stream.
   *   const data = hmac.read();
   *   if (data) {
   *     console.log(data.toString('hex'));
   *     // Prints:
   *     //   7fd04df92f636fd450bc841c9418e5825c17f33ad9c87c518115a45971f7f77e
   *   }
   * });
   *
   * hmac.write('some data to hash');
   * hmac.end();
   * ```
   *
   * Example: Using `Hmac` and piped streams:
   *
   * ```js
   * import { createReadStream } from 'fs';
   * import { stdout } from 'process';
   * const {
   *   createHmac
   * } = await import('crypto');
   *
   * const hmac = createHmac('sha256', 'a secret');
   *
   * const input = createReadStream('test.js');
   * input.pipe(hmac).pipe(stdout);
   * ```
   *
   * Example: Using the `hmac.update()` and `hmac.digest()` methods:
   *
   * ```js
   * const {
   *   createHmac
   * } = await import('crypto');
   *
   * const hmac = createHmac('sha256', 'a secret');
   *
   * hmac.update('some data to hash');
   * console.log(hmac.digest('hex'));
   * // Prints:
   * //   7fd04df92f636fd450bc841c9418e5825c17f33ad9c87c518115a45971f7f77e
   * ```
   */
  class Hmac extends stream.Transform {
      private constructor();
      /**
       * Updates the `Hmac` content with the given `data`, the encoding of which
       * is given in `inputEncoding`.
       * If `encoding` is not provided, and the `data` is a string, an
       * encoding of `'utf8'` is enforced. If `data` is a `Buffer`, `TypedArray`, or`DataView`, then `inputEncoding` is ignored.
       *
       * This can be called many times with new data as it is streamed.
       * @param inputEncoding The `encoding` of the `data` string.
       */
      update(data: BinaryLike): Hmac;
      update(data: string, inputEncoding: Encoding): Hmac;
      /**
       * Calculates the HMAC digest of all of the data passed using `hmac.update()`.
       * If `encoding` is
       * provided a string is returned; otherwise a `Buffer` is returned;
       *
       * The `Hmac` object can not be used again after `hmac.digest()` has been
       * called. Multiple calls to `hmac.digest()` will result in an error being thrown.
       * @param encoding The `encoding` of the return value.
       */
      digest(): Buffer;
      digest(encoding: BinaryToTextEncoding): string;
  }
  type KeyObjectType = 'secret' | 'public' | 'private';
  interface KeyExportOptions<T extends KeyFormat> {
      type: 'pkcs1' | 'spki' | 'pkcs8' | 'sec1';
      format: T;
      cipher?: string | undefined;
      passphrase?: string | Buffer | undefined;
  }
  interface JwkKeyExportOptions {
      format: 'jwk';
  }
  interface JsonWebKey {
      crv?: string | undefined;
      d?: string | undefined;
      dp?: string | undefined;
      dq?: string | undefined;
      e?: string | undefined;
      k?: string | undefined;
      kty?: string | undefined;
      n?: string | undefined;
      p?: string | undefined;
      q?: string | undefined;
      qi?: string | undefined;
      x?: string | undefined;
      y?: string | undefined;
      [key: string]: unknown;
  }
  interface AsymmetricKeyDetails {
      /**
       * Key size in bits (RSA, DSA).
       */
      modulusLength?: number | undefined;
      /**
       * Public exponent (RSA).
       */
      publicExponent?: bigint | undefined;
      /**
       * Name of the message digest (RSA-PSS).
       */
      hashAlgorithm?: string | undefined;
      /**
       * Name of the message digest used by MGF1 (RSA-PSS).
       */
      mgf1HashAlgorithm?: string | undefined;
      /**
       * Minimal salt length in bytes (RSA-PSS).
       */
      saltLength?: number | undefined;
      /**
       * Size of q in bits (DSA).
       */
      divisorLength?: number | undefined;
      /**
       * Name of the curve (EC).
       */
      namedCurve?: string | undefined;
  }
  interface JwkKeyExportOptions {
      format: 'jwk';
  }
  /**
   * Node.js uses a `KeyObject` class to represent a symmetric or asymmetric key,
   * and each kind of key exposes different functions. The {@link createSecretKey}, {@link createPublicKey} and {@link createPrivateKey} methods are used to create `KeyObject`instances. `KeyObject`
   * objects are not to be created directly using the `new`keyword.
   *
   * Most applications should consider using the new `KeyObject` API instead of
   * passing keys as strings or `Buffer`s due to improved security features.
   *
   * `KeyObject` instances can be passed to other threads via `postMessage()`.
   * The receiver obtains a cloned `KeyObject`, and the `KeyObject` does not need to
   * be listed in the `transferList` argument.
   */
  class KeyObject {
      private constructor();
      /**
       * Example: Converting a `CryptoKey` instance to a `KeyObject`:
       *
       * ```js
       * const { webcrypto, KeyObject } = await import('crypto');
       * const { subtle } = webcrypto;
       *
       * const key = await subtle.generateKey({
       *   name: 'HMAC',
       *   hash: 'SHA-256',
       *   length: 256
       * }, true, ['sign', 'verify']);
       *
       * const keyObject = KeyObject.from(key);
       * console.log(keyObject.symmetricKeySize);
       * // Prints: 32 (symmetric key size in bytes)
       * ```
       */
      // static from(key: webcrypto.CryptoKey): KeyObject;
      /**
       * For asymmetric keys, this property represents the type of the key. Supported key
       * types are:
       *
       * * `'rsa'` (OID 1.2.840.113549.1.1.1)
       * * `'rsa-pss'` (OID 1.2.840.113549.1.1.10)
       * * `'dsa'` (OID 1.2.840.10040.4.1)
       * * `'ec'` (OID 1.2.840.10045.2.1)
       * * `'x25519'` (OID 1.3.101.110)
       * * `'x448'` (OID 1.3.101.111)
       * * `'ed25519'` (OID 1.3.101.112)
       * * `'ed448'` (OID 1.3.101.113)
       * * `'dh'` (OID 1.2.840.113549.1.3.1)
       *
       * This property is `undefined` for unrecognized `KeyObject` types and symmetric
       * keys.
       */
      asymmetricKeyType?: KeyType | undefined;
      /**
       * For asymmetric keys, this property represents the size of the embedded key in
       * bytes. This property is `undefined` for symmetric keys.
       */
      asymmetricKeySize?: number | undefined;
      /**
       * This property exists only on asymmetric keys. Depending on the type of the key,
       * this object contains information about the key. None of the information obtained
       * through this property can be used to uniquely identify a key or to compromise
       * the security of the key.
       *
       * For RSA-PSS keys, if the key material contains a `RSASSA-PSS-params` sequence,
       * the `hashAlgorithm`, `mgf1HashAlgorithm`, and `saltLength` properties will be
       * set.
       *
       * Other key details might be exposed via this API using additional attributes.
       */
      asymmetricKeyDetails?: AsymmetricKeyDetails | undefined;
      /**
       * For symmetric keys, the following encoding options can be used:
       *
       * For public keys, the following encoding options can be used:
       *
       * For private keys, the following encoding options can be used:
       *
       * The result type depends on the selected encoding format, when PEM the
       * result is a string, when DER it will be a buffer containing the data
       * encoded as DER, when [JWK](https://tools.ietf.org/html/rfc7517) it will be an object.
       *
       * When [JWK](https://tools.ietf.org/html/rfc7517) encoding format was selected, all other encoding options are
       * ignored.
       *
       * PKCS#1, SEC1, and PKCS#8 type keys can be encrypted by using a combination of
       * the `cipher` and `format` options. The PKCS#8 `type` can be used with any`format` to encrypt any key algorithm (RSA, EC, or DH) by specifying a`cipher`. PKCS#1 and SEC1 can only be
       * encrypted by specifying a `cipher`when the PEM `format` is used. For maximum compatibility, use PKCS#8 for
       * encrypted private keys. Since PKCS#8 defines its own
       * encryption mechanism, PEM-level encryption is not supported when encrypting
       * a PKCS#8 key. See [RFC 5208](https://www.rfc-editor.org/rfc/rfc5208.txt) for PKCS#8 encryption and [RFC 1421](https://www.rfc-editor.org/rfc/rfc1421.txt) for
       * PKCS#1 and SEC1 encryption.
       */
      export(options: KeyExportOptions<'pem'>): string | Buffer;
      export(options?: KeyExportOptions<'der'>): Buffer;
      export(options?: JwkKeyExportOptions): JsonWebKey;
      /**
       * For secret keys, this property represents the size of the key in bytes. This
       * property is `undefined` for asymmetric keys.
       */
      symmetricKeySize?: number | undefined;
      /**
       * Depending on the type of this `KeyObject`, this property is either`'secret'` for secret (symmetric) keys, `'public'` for public (asymmetric) keys
       * or `'private'` for private (asymmetric) keys.
       */
      type: KeyObjectType;
  }
  type CipherCCMTypes = 'aes-128-ccm' | 'aes-192-ccm' | 'aes-256-ccm' | 'chacha20-poly1305';
  type CipherGCMTypes = 'aes-128-gcm' | 'aes-192-gcm' | 'aes-256-gcm';
  type CipherOCBTypes = 'aes-128-ocb' | 'aes-192-ocb' | 'aes-256-ocb';
  type BinaryLike = string | ArrayBufferView;
  type CipherKey = BinaryLike | KeyObject;
  interface CipherCCMOptions extends stream.TransformOptions {
      authTagLength: number;
  }
  interface CipherGCMOptions extends stream.TransformOptions {
      authTagLength?: number | undefined;
  }
  interface CipherOCBOptions extends stream.TransformOptions {
      authTagLength: number;
  }
  /**
   * Creates and returns a `Cipher` object that uses the given `algorithm` and`password`.
   *
   * The `options` argument controls stream behavior and is optional except when a
   * cipher in CCM or OCB mode (e.g. `'aes-128-ccm'`) is used. In that case, the`authTagLength` option is required and specifies the length of the
   * authentication tag in bytes, see `CCM mode`. In GCM mode, the `authTagLength`option is not required but can be used to set the length of the authentication
   * tag that will be returned by `getAuthTag()` and defaults to 16 bytes.
   * For `chacha20-poly1305`, the `authTagLength` option defaults to 16 bytes.
   *
   * The `algorithm` is dependent on OpenSSL, examples are `'aes192'`, etc. On
   * recent OpenSSL releases, `openssl list -cipher-algorithms` will
   * display the available cipher algorithms.
   *
   * The `password` is used to derive the cipher key and initialization vector (IV).
   * The value must be either a `'latin1'` encoded string, a `Buffer`, a`TypedArray`, or a `DataView`.
   *
   * The implementation of `crypto.createCipher()` derives keys using the OpenSSL
   * function [`EVP_BytesToKey`](https://www.openssl.org/docs/man1.1.0/crypto/EVP_BytesToKey.html) with the digest algorithm set to MD5, one
   * iteration, and no salt. The lack of salt allows dictionary attacks as the same
   * password always creates the same key. The low iteration count and
   * non-cryptographically secure hash algorithm allow passwords to be tested very
   * rapidly.
   *
   * In line with OpenSSL's recommendation to use a more modern algorithm instead of [`EVP_BytesToKey`](https://www.openssl.org/docs/man1.1.0/crypto/EVP_BytesToKey.html) it is recommended that
   * developers derive a key and IV on
   * their own using {@link scrypt} and to use {@link createCipheriv} to create the `Cipher` object. Users should not use ciphers with counter mode
   * (e.g. CTR, GCM, or CCM) in `crypto.createCipher()`. A warning is emitted when
   * they are used in order to avoid the risk of IV reuse that causes
   * vulnerabilities. For the case when IV is reused in GCM, see [Nonce-Disrespecting Adversaries](https://github.com/nonce-disrespect/nonce-disrespect) for details.
   * @deprecated Since v10.0.0 - Use {@link createCipheriv} instead.
   * @param options `stream.transform` options
   */
  function createCipher(algorithm: CipherCCMTypes, password: BinaryLike, options: CipherCCMOptions): CipherCCM;
  /** @deprecated since v10.0.0 use `createCipheriv()` */
  function createCipher(algorithm: CipherGCMTypes, password: BinaryLike, options?: CipherGCMOptions): CipherGCM;
  /** @deprecated since v10.0.0 use `createCipheriv()` */
  function createCipher(algorithm: string, password: BinaryLike, options?: stream.TransformOptions): Cipher;
  /**
   * Creates and returns a `Cipher` object, with the given `algorithm`, `key` and
   * initialization vector (`iv`).
   *
   * The `options` argument controls stream behavior and is optional except when a
   * cipher in CCM or OCB mode (e.g. `'aes-128-ccm'`) is used. In that case, the`authTagLength` option is required and specifies the length of the
   * authentication tag in bytes, see `CCM mode`. In GCM mode, the `authTagLength`option is not required but can be used to set the length of the authentication
   * tag that will be returned by `getAuthTag()` and defaults to 16 bytes.
   * For `chacha20-poly1305`, the `authTagLength` option defaults to 16 bytes.
   *
   * The `algorithm` is dependent on OpenSSL, examples are `'aes192'`, etc. On
   * recent OpenSSL releases, `openssl list -cipher-algorithms` will
   * display the available cipher algorithms.
   *
   * The `key` is the raw key used by the `algorithm` and `iv` is an [initialization vector](https://en.wikipedia.org/wiki/Initialization_vector). Both arguments must be `'utf8'` encoded
   * strings,`Buffers`, `TypedArray`, or `DataView`s. The `key` may optionally be
   * a `KeyObject` of type `secret`. If the cipher does not need
   * an initialization vector, `iv` may be `null`.
   *
   * When passing strings for `key` or `iv`, please consider `caveats when using strings as inputs to cryptographic APIs`.
   *
   * Initialization vectors should be unpredictable and unique; ideally, they will be
   * cryptographically random. They do not have to be secret: IVs are typically just
   * added to ciphertext messages unencrypted. It may sound contradictory that
   * something has to be unpredictable and unique, but does not have to be secret;
   * remember that an attacker must not be able to predict ahead of time what a
   * given IV will be.
   * @param options `stream.transform` options
   */
  function createCipheriv(algorithm: CipherCCMTypes, key: CipherKey, iv: BinaryLike, options: CipherCCMOptions): CipherCCM;
  function createCipheriv(algorithm: CipherOCBTypes, key: CipherKey, iv: BinaryLike, options: CipherOCBOptions): CipherOCB;
  function createCipheriv(algorithm: CipherGCMTypes, key: CipherKey, iv: BinaryLike, options?: CipherGCMOptions): CipherGCM;
  function createCipheriv(algorithm: string, key: CipherKey, iv: BinaryLike | null, options?: stream.TransformOptions): Cipher;
  /**
   * Instances of the `Cipher` class are used to encrypt data. The class can be
   * used in one of two ways:
   *
   * * As a `stream` that is both readable and writable, where plain unencrypted
   * data is written to produce encrypted data on the readable side, or
   * * Using the `cipher.update()` and `cipher.final()` methods to produce
   * the encrypted data.
   *
   * The {@link createCipher} or {@link createCipheriv} methods are
   * used to create `Cipher` instances. `Cipher` objects are not to be created
   * directly using the `new` keyword.
   *
   * Example: Using `Cipher` objects as streams:
   *
   * ```js
   * const {
   *   scrypt,
   *   randomFill,
   *   createCipheriv
   * } = await import('crypto');
   *
   * const algorithm = 'aes-192-cbc';
   * const password = 'Password used to generate key';
   *
   * // First, we'll generate the key. The key length is dependent on the algorithm.
   * // In this case for aes192, it is 24 bytes (192 bits).
   * scrypt(password, 'salt', 24, (err, key) => {
   *   if (err) throw err;
   *   // Then, we'll generate a random initialization vector
   *   randomFill(new Uint8Array(16), (err, iv) => {
   *     if (err) throw err;
   *
   *     // Once we have the key and iv, we can create and use the cipher...
   *     const cipher = createCipheriv(algorithm, key, iv);
   *
   *     let encrypted = '';
   *     cipher.setEncoding('hex');
   *
   *     cipher.on('data', (chunk) => encrypted += chunk);
   *     cipher.on('end', () => console.log(encrypted));
   *
   *     cipher.write('some clear text data');
   *     cipher.end();
   *   });
   * });
   * ```
   *
   * Example: Using `Cipher` and piped streams:
   *
   * ```js
   * import {
   *   createReadStream,
   *   createWriteStream,
   * } from 'fs';
   *
   * import {
   *   pipeline
   * } from 'stream';
   *
   * const {
   *   scrypt,
   *   randomFill,
   *   createCipheriv
   * } = await import('crypto');
   *
   * const algorithm = 'aes-192-cbc';
   * const password = 'Password used to generate key';
   *
   * // First, we'll generate the key. The key length is dependent on the algorithm.
   * // In this case for aes192, it is 24 bytes (192 bits).
   * scrypt(password, 'salt', 24, (err, key) => {
   *   if (err) throw err;
   *   // Then, we'll generate a random initialization vector
   *   randomFill(new Uint8Array(16), (err, iv) => {
   *     if (err) throw err;
   *
   *     const cipher = createCipheriv(algorithm, key, iv);
   *
   *     const input = createReadStream('test.js');
   *     const output = createWriteStream('test.enc');
   *
   *     pipeline(input, cipher, output, (err) => {
   *       if (err) throw err;
   *     });
   *   });
   * });
   * ```
   *
   * Example: Using the `cipher.update()` and `cipher.final()` methods:
   *
   * ```js
   * const {
   *   scrypt,
   *   randomFill,
   *   createCipheriv
   * } = await import('crypto');
   *
   * const algorithm = 'aes-192-cbc';
   * const password = 'Password used to generate key';
   *
   * // First, we'll generate the key. The key length is dependent on the algorithm.
   * // In this case for aes192, it is 24 bytes (192 bits).
   * scrypt(password, 'salt', 24, (err, key) => {
   *   if (err) throw err;
   *   // Then, we'll generate a random initialization vector
   *   randomFill(new Uint8Array(16), (err, iv) => {
   *     if (err) throw err;
   *
   *     const cipher = createCipheriv(algorithm, key, iv);
   *
   *     let encrypted = cipher.update('some clear text data', 'utf8', 'hex');
   *     encrypted += cipher.final('hex');
   *     console.log(encrypted);
   *   });
   * });
   * ```
   */
  class Cipher extends stream.Transform {
      private constructor();
      /**
       * Updates the cipher with `data`. If the `inputEncoding` argument is given,
       * the `data`argument is a string using the specified encoding. If the `inputEncoding`argument is not given, `data` must be a `Buffer`, `TypedArray`, or`DataView`. If `data` is a `Buffer`,
       * `TypedArray`, or `DataView`, then`inputEncoding` is ignored.
       *
       * The `outputEncoding` specifies the output format of the enciphered
       * data. If the `outputEncoding`is specified, a string using the specified encoding is returned. If no`outputEncoding` is provided, a `Buffer` is returned.
       *
       * The `cipher.update()` method can be called multiple times with new data until `cipher.final()` is called. Calling `cipher.update()` after `cipher.final()` will result in an error being
       * thrown.
       * @param inputEncoding The `encoding` of the data.
       * @param outputEncoding The `encoding` of the return value.
       */
      update(data: BinaryLike): Buffer;
      update(data: string, inputEncoding: Encoding): Buffer;
      update(data: ArrayBufferView, inputEncoding: undefined, outputEncoding: Encoding): string;
      update(data: string, inputEncoding: Encoding | undefined, outputEncoding: Encoding): string;
      /**
       * Once the `cipher.final()` method has been called, the `Cipher` object can no
       * longer be used to encrypt data. Attempts to call `cipher.final()` more than
       * once will result in an error being thrown.
       * @param outputEncoding The `encoding` of the return value.
       * @return Any remaining enciphered contents. If `outputEncoding` is specified, a string is returned. If an `outputEncoding` is not provided, a {@link Buffer} is returned.
       */
      final(): Buffer;
      final(outputEncoding: BufferEncoding): string;
      /**
       * When using block encryption algorithms, the `Cipher` class will automatically
       * add padding to the input data to the appropriate block size. To disable the
       * default padding call `cipher.setAutoPadding(false)`.
       *
       * When `autoPadding` is `false`, the length of the entire input data must be a
       * multiple of the cipher's block size or `cipher.final()` will throw an error.
       * Disabling automatic padding is useful for non-standard padding, for instance
       * using `0x0` instead of PKCS padding.
       *
       * The `cipher.setAutoPadding()` method must be called before `cipher.final()`.
       * @param [autoPadding=true]
       * @return for method chaining.
       */
      setAutoPadding(autoPadding?: boolean): this;
  }
  interface CipherCCM extends Cipher {
      setAAD(
          buffer: ArrayBufferView,
          options: {
              plaintextLength: number;
          }
      ): this;
      getAuthTag(): Buffer;
  }
  interface CipherGCM extends Cipher {
      setAAD(
          buffer: ArrayBufferView,
          options?: {
              plaintextLength: number;
          }
      ): this;
      getAuthTag(): Buffer;
  }
  interface CipherOCB extends Cipher {
      setAAD(
          buffer: ArrayBufferView,
          options?: {
              plaintextLength: number;
          }
      ): this;
      getAuthTag(): Buffer;
  }
  /**
   * Creates and returns a `Decipher` object that uses the given `algorithm` and`password` (key).
   *
   * The `options` argument controls stream behavior and is optional except when a
   * cipher in CCM or OCB mode (e.g. `'aes-128-ccm'`) is used. In that case, the`authTagLength` option is required and specifies the length of the
   * authentication tag in bytes, see `CCM mode`.
   * For `chacha20-poly1305`, the `authTagLength` option defaults to 16 bytes.
   *
   * The implementation of `crypto.createDecipher()` derives keys using the OpenSSL
   * function [`EVP_BytesToKey`](https://www.openssl.org/docs/man1.1.0/crypto/EVP_BytesToKey.html) with the digest algorithm set to MD5, one
   * iteration, and no salt. The lack of salt allows dictionary attacks as the same
   * password always creates the same key. The low iteration count and
   * non-cryptographically secure hash algorithm allow passwords to be tested very
   * rapidly.
   *
   * In line with OpenSSL's recommendation to use a more modern algorithm instead of [`EVP_BytesToKey`](https://www.openssl.org/docs/man1.1.0/crypto/EVP_BytesToKey.html) it is recommended that
   * developers derive a key and IV on
   * their own using {@link scrypt} and to use {@link createDecipheriv} to create the `Decipher` object.
   * @deprecated Since v10.0.0 - Use {@link createDecipheriv} instead.
   * @param options `stream.transform` options
   */
  function createDecipher(algorithm: CipherCCMTypes, password: BinaryLike, options: CipherCCMOptions): DecipherCCM;
  /** @deprecated since v10.0.0 use `createDecipheriv()` */
  function createDecipher(algorithm: CipherGCMTypes, password: BinaryLike, options?: CipherGCMOptions): DecipherGCM;
  /** @deprecated since v10.0.0 use `createDecipheriv()` */
  function createDecipher(algorithm: string, password: BinaryLike, options?: stream.TransformOptions): Decipher;
  /**
   * Creates and returns a `Decipher` object that uses the given `algorithm`, `key`and initialization vector (`iv`).
   *
   * The `options` argument controls stream behavior and is optional except when a
   * cipher in CCM or OCB mode (e.g. `'aes-128-ccm'`) is used. In that case, the`authTagLength` option is required and specifies the length of the
   * authentication tag in bytes, see `CCM mode`. In GCM mode, the `authTagLength`option is not required but can be used to restrict accepted authentication tags
   * to those with the specified length.
   * For `chacha20-poly1305`, the `authTagLength` option defaults to 16 bytes.
   *
   * The `algorithm` is dependent on OpenSSL, examples are `'aes192'`, etc. On
   * recent OpenSSL releases, `openssl list -cipher-algorithms` will
   * display the available cipher algorithms.
   *
   * The `key` is the raw key used by the `algorithm` and `iv` is an [initialization vector](https://en.wikipedia.org/wiki/Initialization_vector). Both arguments must be `'utf8'` encoded
   * strings,`Buffers`, `TypedArray`, or `DataView`s. The `key` may optionally be
   * a `KeyObject` of type `secret`. If the cipher does not need
   * an initialization vector, `iv` may be `null`.
   *
   * When passing strings for `key` or `iv`, please consider `caveats when using strings as inputs to cryptographic APIs`.
   *
   * Initialization vectors should be unpredictable and unique; ideally, they will be
   * cryptographically random. They do not have to be secret: IVs are typically just
   * added to ciphertext messages unencrypted. It may sound contradictory that
   * something has to be unpredictable and unique, but does not have to be secret;
   * remember that an attacker must not be able to predict ahead of time what a given
   * IV will be.
   * @param options `stream.transform` options
   */
  function createDecipheriv(algorithm: CipherCCMTypes, key: CipherKey, iv: BinaryLike, options: CipherCCMOptions): DecipherCCM;
  function createDecipheriv(algorithm: CipherOCBTypes, key: CipherKey, iv: BinaryLike, options: CipherOCBOptions): DecipherOCB;
  function createDecipheriv(algorithm: CipherGCMTypes, key: CipherKey, iv: BinaryLike, options?: CipherGCMOptions): DecipherGCM;
  function createDecipheriv(algorithm: string, key: CipherKey, iv: BinaryLike | null, options?: stream.TransformOptions): Decipher;
  /**
   * Instances of the `Decipher` class are used to decrypt data. The class can be
   * used in one of two ways:
   *
   * * As a `stream` that is both readable and writable, where plain encrypted
   * data is written to produce unencrypted data on the readable side, or
   * * Using the `decipher.update()` and `decipher.final()` methods to
   * produce the unencrypted data.
   *
   * The {@link createDecipher} or {@link createDecipheriv} methods are
   * used to create `Decipher` instances. `Decipher` objects are not to be created
   * directly using the `new` keyword.
   *
   * Example: Using `Decipher` objects as streams:
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const {
   *   scryptSync,
   *   createDecipheriv
   * } = await import('crypto');
   *
   * const algorithm = 'aes-192-cbc';
   * const password = 'Password used to generate key';
   * // Key length is dependent on the algorithm. In this case for aes192, it is
   * // 24 bytes (192 bits).
   * // Use the async `crypto.scrypt()` instead.
   * const key = scryptSync(password, 'salt', 24);
   * // The IV is usually passed along with the ciphertext.
   * const iv = Buffer.alloc(16, 0); // Initialization vector.
   *
   * const decipher = createDecipheriv(algorithm, key, iv);
   *
   * let decrypted = '';
   * decipher.on('readable', () => {
   *   while (null !== (chunk = decipher.read())) {
   *     decrypted += chunk.toString('utf8');
   *   }
   * });
   * decipher.on('end', () => {
   *   console.log(decrypted);
   *   // Prints: some clear text data
   * });
   *
   * // Encrypted with same algorithm, key and iv.
   * const encrypted =
   *   'e5f79c5915c02171eec6b212d5520d44480993d7d622a7c4c2da32f6efda0ffa';
   * decipher.write(encrypted, 'hex');
   * decipher.end();
   * ```
   *
   * Example: Using `Decipher` and piped streams:
   *
   * ```js
   * import {
   *   createReadStream,
   *   createWriteStream,
   * } from 'fs';
   * import { Buffer } from 'buffer';
   * const {
   *   scryptSync,
   *   createDecipheriv
   * } = await import('crypto');
   *
   * const algorithm = 'aes-192-cbc';
   * const password = 'Password used to generate key';
   * // Use the async `crypto.scrypt()` instead.
   * const key = scryptSync(password, 'salt', 24);
   * // The IV is usually passed along with the ciphertext.
   * const iv = Buffer.alloc(16, 0); // Initialization vector.
   *
   * const decipher = createDecipheriv(algorithm, key, iv);
   *
   * const input = createReadStream('test.enc');
   * const output = createWriteStream('test.js');
   *
   * input.pipe(decipher).pipe(output);
   * ```
   *
   * Example: Using the `decipher.update()` and `decipher.final()` methods:
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const {
   *   scryptSync,
   *   createDecipheriv
   * } = await import('crypto');
   *
   * const algorithm = 'aes-192-cbc';
   * const password = 'Password used to generate key';
   * // Use the async `crypto.scrypt()` instead.
   * const key = scryptSync(password, 'salt', 24);
   * // The IV is usually passed along with the ciphertext.
   * const iv = Buffer.alloc(16, 0); // Initialization vector.
   *
   * const decipher = createDecipheriv(algorithm, key, iv);
   *
   * // Encrypted using same algorithm, key and iv.
   * const encrypted =
   *   'e5f79c5915c02171eec6b212d5520d44480993d7d622a7c4c2da32f6efda0ffa';
   * let decrypted = decipher.update(encrypted, 'hex', 'utf8');
   * decrypted += decipher.final('utf8');
   * console.log(decrypted);
   * // Prints: some clear text data
   * ```
   */
  class Decipher extends stream.Transform {
      private constructor();
      /**
       * Updates the decipher with `data`. If the `inputEncoding` argument is given,
       * the `data`argument is a string using the specified encoding. If the `inputEncoding`argument is not given, `data` must be a `Buffer`. If `data` is a `Buffer` then `inputEncoding` is
       * ignored.
       *
       * The `outputEncoding` specifies the output format of the enciphered
       * data. If the `outputEncoding`is specified, a string using the specified encoding is returned. If no`outputEncoding` is provided, a `Buffer` is returned.
       *
       * The `decipher.update()` method can be called multiple times with new data until `decipher.final()` is called. Calling `decipher.update()` after `decipher.final()` will result in an error
       * being thrown.
       * @param inputEncoding The `encoding` of the `data` string.
       * @param outputEncoding The `encoding` of the return value.
       */
      update(data: ArrayBufferView): Buffer;
      update(data: string, inputEncoding: Encoding): Buffer;
      update(data: ArrayBufferView, inputEncoding: undefined, outputEncoding: Encoding): string;
      update(data: string, inputEncoding: Encoding | undefined, outputEncoding: Encoding): string;
      /**
       * Once the `decipher.final()` method has been called, the `Decipher` object can
       * no longer be used to decrypt data. Attempts to call `decipher.final()` more
       * than once will result in an error being thrown.
       * @param outputEncoding The `encoding` of the return value.
       * @return Any remaining deciphered contents. If `outputEncoding` is specified, a string is returned. If an `outputEncoding` is not provided, a {@link Buffer} is returned.
       */
      final(): Buffer;
      final(outputEncoding: BufferEncoding): string;
      /**
       * When data has been encrypted without standard block padding, calling`decipher.setAutoPadding(false)` will disable automatic padding to prevent `decipher.final()` from checking for and
       * removing padding.
       *
       * Turning auto padding off will only work if the input data's length is a
       * multiple of the ciphers block size.
       *
       * The `decipher.setAutoPadding()` method must be called before `decipher.final()`.
       * @param [autoPadding=true]
       * @return for method chaining.
       */
      setAutoPadding(auto_padding?: boolean): this;
  }
  interface DecipherCCM extends Decipher {
      setAuthTag(buffer: ArrayBufferView): this;
      setAAD(
          buffer: ArrayBufferView,
          options: {
              plaintextLength: number;
          }
      ): this;
  }
  interface DecipherGCM extends Decipher {
      setAuthTag(buffer: ArrayBufferView): this;
      setAAD(
          buffer: ArrayBufferView,
          options?: {
              plaintextLength: number;
          }
      ): this;
  }
  interface DecipherOCB extends Decipher {
      setAuthTag(buffer: ArrayBufferView): this;
      setAAD(
          buffer: ArrayBufferView,
          options?: {
              plaintextLength: number;
          }
      ): this;
  }
  interface PrivateKeyInput {
      key: string | Buffer;
      format?: KeyFormat | undefined;
      type?: 'pkcs1' | 'pkcs8' | 'sec1' | undefined;
      passphrase?: string | Buffer | undefined;
  }
  interface PublicKeyInput {
      key: string | Buffer;
      format?: KeyFormat | undefined;
      type?: 'pkcs1' | 'spki' | undefined;
  }
  /**
   * Asynchronously generates a new random secret key of the given `length`. The`type` will determine which validations will be performed on the `length`.
   *
   * ```js
   * const {
   *   generateKey
   * } = await import('crypto');
   *
   * generateKey('hmac', { length: 64 }, (err, key) => {
   *   if (err) throw err;
   *   console.log(key.export().toString('hex'));  // 46e..........620
   * });
   * ```
   * @param type The intended use of the generated secret key. Currently accepted values are `'hmac'` and `'aes'`.
   */
  function generateKey(
      type: 'hmac' | 'aes',
      options: {
          length: number;
      },
      callback: (err: Error | null, key: KeyObject) => void
  ): void;
  /**
   * Synchronously generates a new random secret key of the given `length`. The`type` will determine which validations will be performed on the `length`.
   *
   * ```js
   * const {
   *   generateKeySync
   * } = await import('crypto');
   *
   * const key = generateKeySync('hmac', { length: 64 });
   * console.log(key.export().toString('hex'));  // e89..........41e
   * ```
   * @param type The intended use of the generated secret key. Currently accepted values are `'hmac'` and `'aes'`.
   */
  function generateKeySync(
      type: 'hmac' | 'aes',
      options: {
          length: number;
      }
  ): KeyObject;
  interface JsonWebKeyInput {
      key: JsonWebKey;
      format: 'jwk';
  }
  /**
   * Creates and returns a new key object containing a private key. If `key` is a
   * string or `Buffer`, `format` is assumed to be `'pem'`; otherwise, `key`must be an object with the properties described above.
   *
   * If the private key is encrypted, a `passphrase` must be specified. The length
   * of the passphrase is limited to 1024 bytes.
   */
  function createPrivateKey(key: PrivateKeyInput | string | Buffer | JsonWebKeyInput): KeyObject;
  /**
   * Creates and returns a new key object containing a public key. If `key` is a
   * string or `Buffer`, `format` is assumed to be `'pem'`; if `key` is a `KeyObject`with type `'private'`, the public key is derived from the given private key;
   * otherwise, `key` must be an object with the properties described above.
   *
   * If the format is `'pem'`, the `'key'` may also be an X.509 certificate.
   *
   * Because public keys can be derived from private keys, a private key may be
   * passed instead of a public key. In that case, this function behaves as if {@link createPrivateKey} had been called, except that the type of the
   * returned `KeyObject` will be `'public'` and that the private key cannot be
   * extracted from the returned `KeyObject`. Similarly, if a `KeyObject` with type`'private'` is given, a new `KeyObject` with type `'public'` will be returned
   * and it will be impossible to extract the private key from the returned object.
   */
  function createPublicKey(key: PublicKeyInput | string | Buffer | KeyObject | JsonWebKeyInput): KeyObject;
  /**
   * Creates and returns a new key object containing a secret key for symmetric
   * encryption or `Hmac`.
   * @param encoding The string encoding when `key` is a string.
   */
  function createSecretKey(key: ArrayBufferView): KeyObject;
  function createSecretKey(key: string, encoding: BufferEncoding): KeyObject;
  /**
   * Creates and returns a `Sign` object that uses the given `algorithm`. Use {@link getHashes} to obtain the names of the available digest algorithms.
   * Optional `options` argument controls the `stream.Writable` behavior.
   *
   * In some cases, a `Sign` instance can be created using the name of a signature
   * algorithm, such as `'RSA-SHA256'`, instead of a digest algorithm. This will use
   * the corresponding digest algorithm. This does not work for all signature
   * algorithms, such as `'ecdsa-with-SHA256'`, so it is best to always use digest
   * algorithm names.
   * @param options `stream.Writable` options
   */
  function createSign(algorithm: string, options?: stream.WritableOptions): Sign;
  type DSAEncoding = 'der' | 'ieee-p1363';
  interface SigningOptions {
      /**
       * @See crypto.constants.RSA_PKCS1_PADDING
       */
      padding?: number | undefined;
      saltLength?: number | undefined;
      dsaEncoding?: DSAEncoding | undefined;
  }
  interface SignPrivateKeyInput extends PrivateKeyInput, SigningOptions {}
  interface SignKeyObjectInput extends SigningOptions {
      key: KeyObject;
  }
  interface VerifyPublicKeyInput extends PublicKeyInput, SigningOptions {}
  interface VerifyKeyObjectInput extends SigningOptions {
      key: KeyObject;
  }
  type KeyLike = string | Buffer | KeyObject;
  /**
   * The `Sign` class is a utility for generating signatures. It can be used in one
   * of two ways:
   *
   * * As a writable `stream`, where data to be signed is written and the `sign.sign()` method is used to generate and return the signature, or
   * * Using the `sign.update()` and `sign.sign()` methods to produce the
   * signature.
   *
   * The {@link createSign} method is used to create `Sign` instances. The
   * argument is the string name of the hash function to use. `Sign` objects are not
   * to be created directly using the `new` keyword.
   *
   * Example: Using `Sign` and `Verify` objects as streams:
   *
   * ```js
   * const {
   *   generateKeyPairSync,
   *   createSign,
   *   createVerify
   * } = await import('crypto');
   *
   * const { privateKey, publicKey } = generateKeyPairSync('ec', {
   *   namedCurve: 'sect239k1'
   * });
   *
   * const sign = createSign('SHA256');
   * sign.write('some data to sign');
   * sign.end();
   * const signature = sign.sign(privateKey, 'hex');
   *
   * const verify = createVerify('SHA256');
   * verify.write('some data to sign');
   * verify.end();
   * console.log(verify.verify(publicKey, signature, 'hex'));
   * // Prints: true
   * ```
   *
   * Example: Using the `sign.update()` and `verify.update()` methods:
   *
   * ```js
   * const {
   *   generateKeyPairSync,
   *   createSign,
   *   createVerify
   * } = await import('crypto');
   *
   * const { privateKey, publicKey } = generateKeyPairSync('rsa', {
   *   modulusLength: 2048,
   * });
   *
   * const sign = createSign('SHA256');
   * sign.update('some data to sign');
   * sign.end();
   * const signature = sign.sign(privateKey);
   *
   * const verify = createVerify('SHA256');
   * verify.update('some data to sign');
   * verify.end();
   * console.log(verify.verify(publicKey, signature));
   * // Prints: true
   * ```
   */
  class Sign extends stream.Writable {
      private constructor();
      /**
       * Updates the `Sign` content with the given `data`, the encoding of which
       * is given in `inputEncoding`.
       * If `encoding` is not provided, and the `data` is a string, an
       * encoding of `'utf8'` is enforced. If `data` is a `Buffer`, `TypedArray`, or`DataView`, then `inputEncoding` is ignored.
       *
       * This can be called many times with new data as it is streamed.
       * @param inputEncoding The `encoding` of the `data` string.
       */
      update(data: BinaryLike): this;
      update(data: string, inputEncoding: Encoding): this;
      /**
       * Calculates the signature on all the data passed through using either `sign.update()` or `sign.write()`.
       *
       * If `privateKey` is not a `KeyObject`, this function behaves as if`privateKey` had been passed to {@link createPrivateKey}. If it is an
       * object, the following additional properties can be passed:
       *
       * If `outputEncoding` is provided a string is returned; otherwise a `Buffer` is returned.
       *
       * The `Sign` object can not be again used after `sign.sign()` method has been
       * called. Multiple calls to `sign.sign()` will result in an error being thrown.
       */
      sign(privateKey: KeyLike | SignKeyObjectInput | SignPrivateKeyInput): Buffer;
      sign(privateKey: KeyLike | SignKeyObjectInput | SignPrivateKeyInput, outputFormat: BinaryToTextEncoding): string;
  }
  /**
   * Creates and returns a `Verify` object that uses the given algorithm.
   * Use {@link getHashes} to obtain an array of names of the available
   * signing algorithms. Optional `options` argument controls the`stream.Writable` behavior.
   *
   * In some cases, a `Verify` instance can be created using the name of a signature
   * algorithm, such as `'RSA-SHA256'`, instead of a digest algorithm. This will use
   * the corresponding digest algorithm. This does not work for all signature
   * algorithms, such as `'ecdsa-with-SHA256'`, so it is best to always use digest
   * algorithm names.
   * @param options `stream.Writable` options
   */
  function createVerify(algorithm: string, options?: stream.WritableOptions): Verify;
  /**
   * The `Verify` class is a utility for verifying signatures. It can be used in one
   * of two ways:
   *
   * * As a writable `stream` where written data is used to validate against the
   * supplied signature, or
   * * Using the `verify.update()` and `verify.verify()` methods to verify
   * the signature.
   *
   * The {@link createVerify} method is used to create `Verify` instances.`Verify` objects are not to be created directly using the `new` keyword.
   *
   * See `Sign` for examples.
   */
  class Verify extends stream.Writable {
      private constructor();
      /**
       * Updates the `Verify` content with the given `data`, the encoding of which
       * is given in `inputEncoding`.
       * If `inputEncoding` is not provided, and the `data` is a string, an
       * encoding of `'utf8'` is enforced. If `data` is a `Buffer`, `TypedArray`, or`DataView`, then `inputEncoding` is ignored.
       *
       * This can be called many times with new data as it is streamed.
       * @param inputEncoding The `encoding` of the `data` string.
       */
      update(data: BinaryLike): Verify;
      update(data: string, inputEncoding: Encoding): Verify;
      /**
       * Verifies the provided data using the given `object` and `signature`.
       *
       * If `object` is not a `KeyObject`, this function behaves as if`object` had been passed to {@link createPublicKey}. If it is an
       * object, the following additional properties can be passed:
       *
       * The `signature` argument is the previously calculated signature for the data, in
       * the `signatureEncoding`.
       * If a `signatureEncoding` is specified, the `signature` is expected to be a
       * string; otherwise `signature` is expected to be a `Buffer`,`TypedArray`, or `DataView`.
       *
       * The `verify` object can not be used again after `verify.verify()` has been
       * called. Multiple calls to `verify.verify()` will result in an error being
       * thrown.
       *
       * Because public keys can be derived from private keys, a private key may
       * be passed instead of a public key.
       */
      verify(object: KeyLike | VerifyKeyObjectInput | VerifyPublicKeyInput, signature: ArrayBufferView): boolean;
      verify(object: KeyLike | VerifyKeyObjectInput | VerifyPublicKeyInput, signature: string, signature_format?: BinaryToTextEncoding): boolean;
  }
  /**
   * Creates a `DiffieHellman` key exchange object using the supplied `prime` and an
   * optional specific `generator`.
   *
   * The `generator` argument can be a number, string, or `Buffer`. If`generator` is not specified, the value `2` is used.
   *
   * If `primeEncoding` is specified, `prime` is expected to be a string; otherwise
   * a `Buffer`, `TypedArray`, or `DataView` is expected.
   *
   * If `generatorEncoding` is specified, `generator` is expected to be a string;
   * otherwise a number, `Buffer`, `TypedArray`, or `DataView` is expected.
   * @param primeEncoding The `encoding` of the `prime` string.
   * @param [generator=2]
   * @param generatorEncoding The `encoding` of the `generator` string.
   */
  function createDiffieHellman(primeLength: number, generator?: number | ArrayBufferView): DiffieHellman;
  function createDiffieHellman(prime: ArrayBufferView): DiffieHellman;
  function createDiffieHellman(prime: string, primeEncoding: BinaryToTextEncoding): DiffieHellman;
  function createDiffieHellman(prime: string, primeEncoding: BinaryToTextEncoding, generator: number | ArrayBufferView): DiffieHellman;
  function createDiffieHellman(prime: string, primeEncoding: BinaryToTextEncoding, generator: string, generatorEncoding: BinaryToTextEncoding): DiffieHellman;
  /**
   * The `DiffieHellman` class is a utility for creating Diffie-Hellman key
   * exchanges.
   *
   * Instances of the `DiffieHellman` class can be created using the {@link createDiffieHellman} function.
   *
   * ```js
   * import assert from 'assert';
   *
   * const {
   *   createDiffieHellman
   * } = await import('crypto');
   *
   * // Generate Alice's keys...
   * const alice = createDiffieHellman(2048);
   * const aliceKey = alice.generateKeys();
   *
   * // Generate Bob's keys...
   * const bob = createDiffieHellman(alice.getPrime(), alice.getGenerator());
   * const bobKey = bob.generateKeys();
   *
   * // Exchange and generate the secret...
   * const aliceSecret = alice.computeSecret(bobKey);
   * const bobSecret = bob.computeSecret(aliceKey);
   *
   * // OK
   * assert.strictEqual(aliceSecret.toString('hex'), bobSecret.toString('hex'));
   * ```
   */
  class DiffieHellman {
      private constructor();
      /**
       * Generates private and public Diffie-Hellman key values, and returns
       * the public key in the specified `encoding`. This key should be
       * transferred to the other party.
       * If `encoding` is provided a string is returned; otherwise a `Buffer` is returned.
       * @param encoding The `encoding` of the return value.
       */
      generateKeys(): Buffer;
      generateKeys(encoding: BinaryToTextEncoding): string;
      /**
       * Computes the shared secret using `otherPublicKey` as the other
       * party's public key and returns the computed shared secret. The supplied
       * key is interpreted using the specified `inputEncoding`, and secret is
       * encoded using specified `outputEncoding`.
       * If the `inputEncoding` is not
       * provided, `otherPublicKey` is expected to be a `Buffer`,`TypedArray`, or `DataView`.
       *
       * If `outputEncoding` is given a string is returned; otherwise, a `Buffer` is returned.
       * @param inputEncoding The `encoding` of an `otherPublicKey` string.
       * @param outputEncoding The `encoding` of the return value.
       */
      computeSecret(otherPublicKey: ArrayBufferView): Buffer;
      computeSecret(otherPublicKey: string, inputEncoding: BinaryToTextEncoding): Buffer;
      computeSecret(otherPublicKey: ArrayBufferView, outputEncoding: BinaryToTextEncoding): string;
      computeSecret(otherPublicKey: string, inputEncoding: BinaryToTextEncoding, outputEncoding: BinaryToTextEncoding): string;
      /**
       * Returns the Diffie-Hellman prime in the specified `encoding`.
       * If `encoding` is provided a string is
       * returned; otherwise a `Buffer` is returned.
       * @param encoding The `encoding` of the return value.
       */
      getPrime(): Buffer;
      getPrime(encoding: BinaryToTextEncoding): string;
      /**
       * Returns the Diffie-Hellman generator in the specified `encoding`.
       * If `encoding` is provided a string is
       * returned; otherwise a `Buffer` is returned.
       * @param encoding The `encoding` of the return value.
       */
      getGenerator(): Buffer;
      getGenerator(encoding: BinaryToTextEncoding): string;
      /**
       * Returns the Diffie-Hellman public key in the specified `encoding`.
       * If `encoding` is provided a
       * string is returned; otherwise a `Buffer` is returned.
       * @param encoding The `encoding` of the return value.
       */
      getPublicKey(): Buffer;
      getPublicKey(encoding: BinaryToTextEncoding): string;
      /**
       * Returns the Diffie-Hellman private key in the specified `encoding`.
       * If `encoding` is provided a
       * string is returned; otherwise a `Buffer` is returned.
       * @param encoding The `encoding` of the return value.
       */
      getPrivateKey(): Buffer;
      getPrivateKey(encoding: BinaryToTextEncoding): string;
      /**
       * Sets the Diffie-Hellman public key. If the `encoding` argument is provided,`publicKey` is expected
       * to be a string. If no `encoding` is provided, `publicKey` is expected
       * to be a `Buffer`, `TypedArray`, or `DataView`.
       * @param encoding The `encoding` of the `publicKey` string.
       */
      setPublicKey(publicKey: ArrayBufferView): void;
      setPublicKey(publicKey: string, encoding: BufferEncoding): void;
      /**
       * Sets the Diffie-Hellman private key. If the `encoding` argument is provided,`privateKey` is expected
       * to be a string. If no `encoding` is provided, `privateKey` is expected
       * to be a `Buffer`, `TypedArray`, or `DataView`.
       * @param encoding The `encoding` of the `privateKey` string.
       */
      setPrivateKey(privateKey: ArrayBufferView): void;
      setPrivateKey(privateKey: string, encoding: BufferEncoding): void;
      /**
       * A bit field containing any warnings and/or errors resulting from a check
       * performed during initialization of the `DiffieHellman` object.
       *
       * The following values are valid for this property (as defined in `constants`module):
       *
       * * `DH_CHECK_P_NOT_SAFE_PRIME`
       * * `DH_CHECK_P_NOT_PRIME`
       * * `DH_UNABLE_TO_CHECK_GENERATOR`
       * * `DH_NOT_SUITABLE_GENERATOR`
       */
      verifyError: number;
  }
  /**
   * Creates a predefined `DiffieHellmanGroup` key exchange object. The
   * supported groups are: `'modp1'`, `'modp2'`, `'modp5'` (defined in [RFC 2412](https://www.rfc-editor.org/rfc/rfc2412.txt), but see `Caveats`) and `'modp14'`, `'modp15'`,`'modp16'`, `'modp17'`,
   * `'modp18'` (defined in [RFC 3526](https://www.rfc-editor.org/rfc/rfc3526.txt)). The
   * returned object mimics the interface of objects created by {@link createDiffieHellman}, but will not allow changing
   * the keys (with `diffieHellman.setPublicKey()`, for example). The
   * advantage of using this method is that the parties do not have to
   * generate nor exchange a group modulus beforehand, saving both processor
   * and communication time.
   *
   * Example (obtaining a shared secret):
   *
   * ```js
   * const {
   *   getDiffieHellman
   * } = await import('crypto');
   * const alice = getDiffieHellman('modp14');
   * const bob = getDiffieHellman('modp14');
   *
   * alice.generateKeys();
   * bob.generateKeys();
   *
   * const aliceSecret = alice.computeSecret(bob.getPublicKey(), null, 'hex');
   * const bobSecret = bob.computeSecret(alice.getPublicKey(), null, 'hex');
   *
   * // aliceSecret and bobSecret should be the same
   * console.log(aliceSecret === bobSecret);
   * ```
   */
  function getDiffieHellman(groupName: string): DiffieHellman;
  /**
   * Provides an asynchronous Password-Based Key Derivation Function 2 (PBKDF2)
   * implementation. A selected HMAC digest algorithm specified by `digest` is
   * applied to derive a key of the requested byte length (`keylen`) from the`password`, `salt` and `iterations`.
   *
   * The supplied `callback` function is called with two arguments: `err` and`derivedKey`. If an error occurs while deriving the key, `err` will be set;
   * otherwise `err` will be `null`. By default, the successfully generated`derivedKey` will be passed to the callback as a `Buffer`. An error will be
   * thrown if any of the input arguments specify invalid values or types.
   *
   * If `digest` is `null`, `'sha1'` will be used. This behavior is deprecated,
   * please specify a `digest` explicitly.
   *
   * The `iterations` argument must be a number set as high as possible. The
   * higher the number of iterations, the more secure the derived key will be,
   * but will take a longer amount of time to complete.
   *
   * The `salt` should be as unique as possible. It is recommended that a salt is
   * random and at least 16 bytes long. See [NIST SP 800-132](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf) for details.
   *
   * When passing strings for `password` or `salt`, please consider `caveats when using strings as inputs to cryptographic APIs`.
   *
   * ```js
   * const {
   *   pbkdf2
   * } = await import('crypto');
   *
   * pbkdf2('secret', 'salt', 100000, 64, 'sha512', (err, derivedKey) => {
   *   if (err) throw err;
   *   console.log(derivedKey.toString('hex'));  // '3745e48...08d59ae'
   * });
   * ```
   *
   * The `crypto.DEFAULT_ENCODING` property can be used to change the way the`derivedKey` is passed to the callback. This property, however, has been
   * deprecated and use should be avoided.
   *
   * ```js
   * import crypto from 'crypto';
   * crypto.DEFAULT_ENCODING = 'hex';
   * crypto.pbkdf2('secret', 'salt', 100000, 512, 'sha512', (err, derivedKey) => {
   *   if (err) throw err;
   *   console.log(derivedKey);  // '3745e48...aa39b34'
   * });
   * ```
   *
   * An array of supported digest functions can be retrieved using {@link getHashes}.
   *
   * This API uses libuv's threadpool, which can have surprising and
   * negative performance implications for some applications; see the `UV_THREADPOOL_SIZE` documentation for more information.
   */
  function pbkdf2(password: BinaryLike, salt: BinaryLike, iterations: number, keylen: number, digest: string, callback: (err: Error | null, derivedKey: Buffer) => void): void;
  /**
   * Provides a synchronous Password-Based Key Derivation Function 2 (PBKDF2)
   * implementation. A selected HMAC digest algorithm specified by `digest` is
   * applied to derive a key of the requested byte length (`keylen`) from the`password`, `salt` and `iterations`.
   *
   * If an error occurs an `Error` will be thrown, otherwise the derived key will be
   * returned as a `Buffer`.
   *
   * If `digest` is `null`, `'sha1'` will be used. This behavior is deprecated,
   * please specify a `digest` explicitly.
   *
   * The `iterations` argument must be a number set as high as possible. The
   * higher the number of iterations, the more secure the derived key will be,
   * but will take a longer amount of time to complete.
   *
   * The `salt` should be as unique as possible. It is recommended that a salt is
   * random and at least 16 bytes long. See [NIST SP 800-132](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf) for details.
   *
   * When passing strings for `password` or `salt`, please consider `caveats when using strings as inputs to cryptographic APIs`.
   *
   * ```js
   * const {
   *   pbkdf2Sync
   * } = await import('crypto');
   *
   * const key = pbkdf2Sync('secret', 'salt', 100000, 64, 'sha512');
   * console.log(key.toString('hex'));  // '3745e48...08d59ae'
   * ```
   *
   * The `crypto.DEFAULT_ENCODING` property may be used to change the way the`derivedKey` is returned. This property, however, is deprecated and use
   * should be avoided.
   *
   * ```js
   * import crypto from 'crypto';
   * crypto.DEFAULT_ENCODING = 'hex';
   * const key = crypto.pbkdf2Sync('secret', 'salt', 100000, 512, 'sha512');
   * console.log(key);  // '3745e48...aa39b34'
   * ```
   *
   * An array of supported digest functions can be retrieved using {@link getHashes}.
   */
  function pbkdf2Sync(password: BinaryLike, salt: BinaryLike, iterations: number, keylen: number, digest: string): Buffer;
  /**
   * Generates cryptographically strong pseudorandom data. The `size` argument
   * is a number indicating the number of bytes to generate.
   *
   * If a `callback` function is provided, the bytes are generated asynchronously
   * and the `callback` function is invoked with two arguments: `err` and `buf`.
   * If an error occurs, `err` will be an `Error` object; otherwise it is `null`. The`buf` argument is a `Buffer` containing the generated bytes.
   *
   * ```js
   * // Asynchronous
   * const {
   *   randomBytes
   * } = await import('crypto');
   *
   * randomBytes(256, (err, buf) => {
   *   if (err) throw err;
   *   console.log(`${buf.length} bytes of random data: ${buf.toString('hex')}`);
   * });
   * ```
   *
   * If the `callback` function is not provided, the random bytes are generated
   * synchronously and returned as a `Buffer`. An error will be thrown if
   * there is a problem generating the bytes.
   *
   * ```js
   * // Synchronous
   * const {
   *   randomBytes
   * } = await import('crypto');
   *
   * const buf = randomBytes(256);
   * console.log(
   *   `${buf.length} bytes of random data: ${buf.toString('hex')}`);
   * ```
   *
   * The `crypto.randomBytes()` method will not complete until there is
   * sufficient entropy available.
   * This should normally never take longer than a few milliseconds. The only time
   * when generating the random bytes may conceivably block for a longer period of
   * time is right after boot, when the whole system is still low on entropy.
   *
   * This API uses libuv's threadpool, which can have surprising and
   * negative performance implications for some applications; see the `UV_THREADPOOL_SIZE` documentation for more information.
   *
   * The asynchronous version of `crypto.randomBytes()` is carried out in a single
   * threadpool request. To minimize threadpool task length variation, partition
   * large `randomBytes` requests when doing so as part of fulfilling a client
   * request.
   * @param size The number of bytes to generate. The `size` must not be larger than `2**31 - 1`.
   * @return if the `callback` function is not provided.
   */
  function randomBytes(size: number): Buffer;
  function randomBytes(size: number, callback: (err: Error | null, buf: Buffer) => void): void;
  function pseudoRandomBytes(size: number): Buffer;
  function pseudoRandomBytes(size: number, callback: (err: Error | null, buf: Buffer) => void): void;
  /**
   * Return a random integer `n` such that `min <= n < max`.  This
   * implementation avoids [modulo bias](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#Modulo_bias).
   *
   * The range (`max - min`) must be less than 248. `min` and `max` must
   * be [safe integers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger).
   *
   * If the `callback` function is not provided, the random integer is
   * generated synchronously.
   *
   * ```js
   * // Asynchronous
   * const {
   *   randomInt
   * } = await import('crypto');
   *
   * randomInt(3, (err, n) => {
   *   if (err) throw err;
   *   console.log(`Random number chosen from (0, 1, 2): ${n}`);
   * });
   * ```
   *
   * ```js
   * // Synchronous
   * const {
   *   randomInt
   * } = await import('crypto');
   *
   * const n = randomInt(3);
   * console.log(`Random number chosen from (0, 1, 2): ${n}`);
   * ```
   *
   * ```js
   * // With `min` argument
   * const {
   *   randomInt
   * } = await import('crypto');
   *
   * const n = randomInt(1, 7);
   * console.log(`The dice rolled: ${n}`);
   * ```
   * @param [min=0] Start of random range (inclusive).
   * @param max End of random range (exclusive).
   * @param callback `function(err, n) {}`.
   */
  function randomInt(max: number): number;
  function randomInt(min: number, max: number): number;
  function randomInt(max: number, callback: (err: Error | null, value: number) => void): void;
  function randomInt(min: number, max: number, callback: (err: Error | null, value: number) => void): void;
  /**
   * Synchronous version of {@link randomFill}.
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const { randomFillSync } = await import('crypto');
   *
   * const buf = Buffer.alloc(10);
   * console.log(randomFillSync(buf).toString('hex'));
   *
   * randomFillSync(buf, 5);
   * console.log(buf.toString('hex'));
   *
   * // The above is equivalent to the following:
   * randomFillSync(buf, 5, 5);
   * console.log(buf.toString('hex'));
   * ```
   *
   * Any `ArrayBuffer`, `TypedArray` or `DataView` instance may be passed as`buffer`.
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const { randomFillSync } = await import('crypto');
   *
   * const a = new Uint32Array(10);
   * console.log(Buffer.from(randomFillSync(a).buffer,
   *                         a.byteOffset, a.byteLength).toString('hex'));
   *
   * const b = new DataView(new ArrayBuffer(10));
   * console.log(Buffer.from(randomFillSync(b).buffer,
   *                         b.byteOffset, b.byteLength).toString('hex'));
   *
   * const c = new ArrayBuffer(10);
   * console.log(Buffer.from(randomFillSync(c)).toString('hex'));
   * ```
   * @param buffer Must be supplied. The size of the provided `buffer` must not be larger than `2**31 - 1`.
   * @param [offset=0]
   * @param [size=buffer.length - offset]
   * @return The object passed as `buffer` argument.
   */
  function randomFillSync<T extends ArrayBufferView>(buffer: T, offset?: number, size?: number): T;
  /**
   * This function is similar to {@link randomBytes} but requires the first
   * argument to be a `Buffer` that will be filled. It also
   * requires that a callback is passed in.
   *
   * If the `callback` function is not provided, an error will be thrown.
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const { randomFill } = await import('crypto');
   *
   * const buf = Buffer.alloc(10);
   * randomFill(buf, (err, buf) => {
   *   if (err) throw err;
   *   console.log(buf.toString('hex'));
   * });
   *
   * randomFill(buf, 5, (err, buf) => {
   *   if (err) throw err;
   *   console.log(buf.toString('hex'));
   * });
   *
   * // The above is equivalent to the following:
   * randomFill(buf, 5, 5, (err, buf) => {
   *   if (err) throw err;
   *   console.log(buf.toString('hex'));
   * });
   * ```
   *
   * Any `ArrayBuffer`, `TypedArray`, or `DataView` instance may be passed as`buffer`.
   *
   * While this includes instances of `Float32Array` and `Float64Array`, this
   * function should not be used to generate random floating-point numbers. The
   * result may contain `+Infinity`, `-Infinity`, and `NaN`, and even if the array
   * contains finite numbers only, they are not drawn from a uniform random
   * distribution and have no meaningful lower or upper bounds.
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const { randomFill } = await import('crypto');
   *
   * const a = new Uint32Array(10);
   * randomFill(a, (err, buf) => {
   *   if (err) throw err;
   *   console.log(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
   *     .toString('hex'));
   * });
   *
   * const b = new DataView(new ArrayBuffer(10));
   * randomFill(b, (err, buf) => {
   *   if (err) throw err;
   *   console.log(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
   *     .toString('hex'));
   * });
   *
   * const c = new ArrayBuffer(10);
   * randomFill(c, (err, buf) => {
   *   if (err) throw err;
   *   console.log(Buffer.from(buf).toString('hex'));
   * });
   * ```
   *
   * This API uses libuv's threadpool, which can have surprising and
   * negative performance implications for some applications; see the `UV_THREADPOOL_SIZE` documentation for more information.
   *
   * The asynchronous version of `crypto.randomFill()` is carried out in a single
   * threadpool request. To minimize threadpool task length variation, partition
   * large `randomFill` requests when doing so as part of fulfilling a client
   * request.
   * @param buffer Must be supplied. The size of the provided `buffer` must not be larger than `2**31 - 1`.
   * @param [offset=0]
   * @param [size=buffer.length - offset]
   * @param callback `function(err, buf) {}`.
   */
  function randomFill<T extends ArrayBufferView>(buffer: T, callback: (err: Error | null, buf: T) => void): void;
  function randomFill<T extends ArrayBufferView>(buffer: T, offset: number, callback: (err: Error | null, buf: T) => void): void;
  function randomFill<T extends ArrayBufferView>(buffer: T, offset: number, size: number, callback: (err: Error | null, buf: T) => void): void;
  interface ScryptOptions {
      cost?: number | undefined;
      blockSize?: number | undefined;
      parallelization?: number | undefined;
      N?: number | undefined;
      r?: number | undefined;
      p?: number | undefined;
      maxmem?: number | undefined;
  }
  /**
   * Provides an asynchronous [scrypt](https://en.wikipedia.org/wiki/Scrypt) implementation. Scrypt is a password-based
   * key derivation function that is designed to be expensive computationally and
   * memory-wise in order to make brute-force attacks unrewarding.
   *
   * The `salt` should be as unique as possible. It is recommended that a salt is
   * random and at least 16 bytes long. See [NIST SP 800-132](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf) for details.
   *
   * When passing strings for `password` or `salt`, please consider `caveats when using strings as inputs to cryptographic APIs`.
   *
   * The `callback` function is called with two arguments: `err` and `derivedKey`.`err` is an exception object when key derivation fails, otherwise `err` is`null`. `derivedKey` is passed to the
   * callback as a `Buffer`.
   *
   * An exception is thrown when any of the input arguments specify invalid values
   * or types.
   *
   * ```js
   * const {
   *   scrypt
   * } = await import('crypto');
   *
   * // Using the factory defaults.
   * scrypt('password', 'salt', 64, (err, derivedKey) => {
   *   if (err) throw err;
   *   console.log(derivedKey.toString('hex'));  // '3745e48...08d59ae'
   * });
   * // Using a custom N parameter. Must be a power of two.
   * scrypt('password', 'salt', 64, { N: 1024 }, (err, derivedKey) => {
   *   if (err) throw err;
   *   console.log(derivedKey.toString('hex'));  // '3745e48...aa39b34'
   * });
   * ```
   */
  function scrypt(password: BinaryLike, salt: BinaryLike, keylen: number, callback: (err: Error | null, derivedKey: Buffer) => void): void;
  function scrypt(password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions, callback: (err: Error | null, derivedKey: Buffer) => void): void;
  /**
   * Provides a synchronous [scrypt](https://en.wikipedia.org/wiki/Scrypt) implementation. Scrypt is a password-based
   * key derivation function that is designed to be expensive computationally and
   * memory-wise in order to make brute-force attacks unrewarding.
   *
   * The `salt` should be as unique as possible. It is recommended that a salt is
   * random and at least 16 bytes long. See [NIST SP 800-132](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf) for details.
   *
   * When passing strings for `password` or `salt`, please consider `caveats when using strings as inputs to cryptographic APIs`.
   *
   * An exception is thrown when key derivation fails, otherwise the derived key is
   * returned as a `Buffer`.
   *
   * An exception is thrown when any of the input arguments specify invalid values
   * or types.
   *
   * ```js
   * const {
   *   scryptSync
   * } = await import('crypto');
   * // Using the factory defaults.
   *
   * const key1 = scryptSync('password', 'salt', 64);
   * console.log(key1.toString('hex'));  // '3745e48...08d59ae'
   * // Using a custom N parameter. Must be a power of two.
   * const key2 = scryptSync('password', 'salt', 64, { N: 1024 });
   * console.log(key2.toString('hex'));  // '3745e48...aa39b34'
   * ```
   */
  function scryptSync(password: BinaryLike, salt: BinaryLike, keylen: number, options?: ScryptOptions): Buffer;
  interface RsaPublicKey {
      key: KeyLike;
      padding?: number | undefined;
  }
  interface RsaPrivateKey {
      key: KeyLike;
      passphrase?: string | undefined;
      /**
       * @default 'sha1'
       */
      oaepHash?: string | undefined;
      oaepLabel?: TypedArray | undefined;
      padding?: number | undefined;
  }
  /**
   * Encrypts the content of `buffer` with `key` and returns a new `Buffer` with encrypted content. The returned data can be decrypted using
   * the corresponding private key, for example using {@link privateDecrypt}.
   *
   * If `key` is not a `KeyObject`, this function behaves as if`key` had been passed to {@link createPublicKey}. If it is an
   * object, the `padding` property can be passed. Otherwise, this function uses`RSA_PKCS1_OAEP_PADDING`.
   *
   * Because RSA public keys can be derived from private keys, a private key may
   * be passed instead of a public key.
   */
  function publicEncrypt(key: RsaPublicKey | RsaPrivateKey | KeyLike, buffer: ArrayBufferView): Buffer;
  /**
   * Decrypts `buffer` with `key`.`buffer` was previously encrypted using
   * the corresponding private key, for example using {@link privateEncrypt}.
   *
   * If `key` is not a `KeyObject`, this function behaves as if`key` had been passed to {@link createPublicKey}. If it is an
   * object, the `padding` property can be passed. Otherwise, this function uses`RSA_PKCS1_PADDING`.
   *
   * Because RSA public keys can be derived from private keys, a private key may
   * be passed instead of a public key.
   */
  function publicDecrypt(key: RsaPublicKey | RsaPrivateKey | KeyLike, buffer: ArrayBufferView): Buffer;
  /**
   * Decrypts `buffer` with `privateKey`. `buffer` was previously encrypted using
   * the corresponding public key, for example using {@link publicEncrypt}.
   *
   * If `privateKey` is not a `KeyObject`, this function behaves as if`privateKey` had been passed to {@link createPrivateKey}. If it is an
   * object, the `padding` property can be passed. Otherwise, this function uses`RSA_PKCS1_OAEP_PADDING`.
   */
  function privateDecrypt(privateKey: RsaPrivateKey | KeyLike, buffer: ArrayBufferView): Buffer;
  /**
   * Encrypts `buffer` with `privateKey`. The returned data can be decrypted using
   * the corresponding public key, for example using {@link publicDecrypt}.
   *
   * If `privateKey` is not a `KeyObject`, this function behaves as if`privateKey` had been passed to {@link createPrivateKey}. If it is an
   * object, the `padding` property can be passed. Otherwise, this function uses`RSA_PKCS1_PADDING`.
   */
  function privateEncrypt(privateKey: RsaPrivateKey | KeyLike, buffer: ArrayBufferView): Buffer;
  /**
   * ```js
   * const {
   *   getCiphers
   * } = await import('crypto');
   *
   * console.log(getCiphers()); // ['aes-128-cbc', 'aes-128-ccm', ...]
   * ```
   * @return An array with the names of the supported cipher algorithms.
   */
  function getCiphers(): string[];
  /**
   * ```js
   * const {
   *   getCurves
   * } = await import('crypto');
   *
   * console.log(getCurves()); // ['Oakley-EC2N-3', 'Oakley-EC2N-4', ...]
   * ```
   * @return An array with the names of the supported elliptic curves.
   */
  function getCurves(): string[];
  /**
   * @return `1` if and only if a FIPS compliant crypto provider is currently in use, `0` otherwise. A future semver-major release may change the return type of this API to a {boolean}.
   */
  function getFips(): 1 | 0;
  /**
   * ```js
   * const {
   *   getHashes
   * } = await import('crypto');
   *
   * console.log(getHashes()); // ['DSA', 'DSA-SHA', 'DSA-SHA1', ...]
   * ```
   * @return An array of the names of the supported hash algorithms, such as `'RSA-SHA256'`. Hash algorithms are also called "digest" algorithms.
   */
  function getHashes(): string[];
  /**
   * The `ECDH` class is a utility for creating Elliptic Curve Diffie-Hellman (ECDH)
   * key exchanges.
   *
   * Instances of the `ECDH` class can be created using the {@link createECDH} function.
   *
   * ```js
   * import assert from 'assert';
   *
   * const {
   *   createECDH
   * } = await import('crypto');
   *
   * // Generate Alice's keys...
   * const alice = createECDH('secp521r1');
   * const aliceKey = alice.generateKeys();
   *
   * // Generate Bob's keys...
   * const bob = createECDH('secp521r1');
   * const bobKey = bob.generateKeys();
   *
   * // Exchange and generate the secret...
   * const aliceSecret = alice.computeSecret(bobKey);
   * const bobSecret = bob.computeSecret(aliceKey);
   *
   * assert.strictEqual(aliceSecret.toString('hex'), bobSecret.toString('hex'));
   * // OK
   * ```
   */
  class ECDH {
      private constructor();
      /**
       * Converts the EC Diffie-Hellman public key specified by `key` and `curve` to the
       * format specified by `format`. The `format` argument specifies point encoding
       * and can be `'compressed'`, `'uncompressed'` or `'hybrid'`. The supplied key is
       * interpreted using the specified `inputEncoding`, and the returned key is encoded
       * using the specified `outputEncoding`.
       *
       * Use {@link getCurves} to obtain a list of available curve names.
       * On recent OpenSSL releases, `openssl ecparam -list_curves` will also display
       * the name and description of each available elliptic curve.
       *
       * If `format` is not specified the point will be returned in `'uncompressed'`format.
       *
       * If the `inputEncoding` is not provided, `key` is expected to be a `Buffer`,`TypedArray`, or `DataView`.
       *
       * Example (uncompressing a key):
       *
       * ```js
       * const {
       *   createECDH,
       *   ECDH
       * } = await import('crypto');
       *
       * const ecdh = createECDH('secp256k1');
       * ecdh.generateKeys();
       *
       * const compressedKey = ecdh.getPublicKey('hex', 'compressed');
       *
       * const uncompressedKey = ECDH.convertKey(compressedKey,
       *                                         'secp256k1',
       *                                         'hex',
       *                                         'hex',
       *                                         'uncompressed');
       *
       * // The converted key and the uncompressed public key should be the same
       * console.log(uncompressedKey === ecdh.getPublicKey('hex'));
       * ```
       * @param inputEncoding The `encoding` of the `key` string.
       * @param outputEncoding The `encoding` of the return value.
       * @param [format='uncompressed']
       */
      static convertKey(
          key: BinaryLike,
          curve: string,
          inputEncoding?: BinaryToTextEncoding,
          outputEncoding?: 'latin1' | 'hex' | 'base64' | 'base64url',
          format?: 'uncompressed' | 'compressed' | 'hybrid'
      ): Buffer | string;
      /**
       * Generates private and public EC Diffie-Hellman key values, and returns
       * the public key in the specified `format` and `encoding`. This key should be
       * transferred to the other party.
       *
       * The `format` argument specifies point encoding and can be `'compressed'` or`'uncompressed'`. If `format` is not specified, the point will be returned in`'uncompressed'` format.
       *
       * If `encoding` is provided a string is returned; otherwise a `Buffer` is returned.
       * @param encoding The `encoding` of the return value.
       * @param [format='uncompressed']
       */
      generateKeys(): Buffer;
      generateKeys(encoding: BinaryToTextEncoding, format?: ECDHKeyFormat): string;
      /**
       * Computes the shared secret using `otherPublicKey` as the other
       * party's public key and returns the computed shared secret. The supplied
       * key is interpreted using specified `inputEncoding`, and the returned secret
       * is encoded using the specified `outputEncoding`.
       * If the `inputEncoding` is not
       * provided, `otherPublicKey` is expected to be a `Buffer`, `TypedArray`, or`DataView`.
       *
       * If `outputEncoding` is given a string will be returned; otherwise a `Buffer` is returned.
       *
       * `ecdh.computeSecret` will throw an`ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY` error when `otherPublicKey`lies outside of the elliptic curve. Since `otherPublicKey` is
       * usually supplied from a remote user over an insecure network,
       * be sure to handle this exception accordingly.
       * @param inputEncoding The `encoding` of the `otherPublicKey` string.
       * @param outputEncoding The `encoding` of the return value.
       */
      computeSecret(otherPublicKey: ArrayBufferView): Buffer;
      computeSecret(otherPublicKey: string, inputEncoding: BinaryToTextEncoding): Buffer;
      computeSecret(otherPublicKey: ArrayBufferView, outputEncoding: BinaryToTextEncoding): string;
      computeSecret(otherPublicKey: string, inputEncoding: BinaryToTextEncoding, outputEncoding: BinaryToTextEncoding): string;
      /**
       * If `encoding` is specified, a string is returned; otherwise a `Buffer` is
       * returned.
       * @param encoding The `encoding` of the return value.
       * @return The EC Diffie-Hellman in the specified `encoding`.
       */
      getPrivateKey(): Buffer;
      getPrivateKey(encoding: BinaryToTextEncoding): string;
      /**
       * The `format` argument specifies point encoding and can be `'compressed'` or`'uncompressed'`. If `format` is not specified the point will be returned in`'uncompressed'` format.
       *
       * If `encoding` is specified, a string is returned; otherwise a `Buffer` is
       * returned.
       * @param encoding The `encoding` of the return value.
       * @param [format='uncompressed']
       * @return The EC Diffie-Hellman public key in the specified `encoding` and `format`.
       */
      getPublicKey(): Buffer;
      getPublicKey(encoding: BinaryToTextEncoding, format?: ECDHKeyFormat): string;
      /**
       * Sets the EC Diffie-Hellman private key.
       * If `encoding` is provided, `privateKey` is expected
       * to be a string; otherwise `privateKey` is expected to be a `Buffer`,`TypedArray`, or `DataView`.
       *
       * If `privateKey` is not valid for the curve specified when the `ECDH` object was
       * created, an error is thrown. Upon setting the private key, the associated
       * public point (key) is also generated and set in the `ECDH` object.
       * @param encoding The `encoding` of the `privateKey` string.
       */
      setPrivateKey(privateKey: ArrayBufferView): void;
      setPrivateKey(privateKey: string, encoding: BinaryToTextEncoding): void;
  }
  /**
   * Creates an Elliptic Curve Diffie-Hellman (`ECDH`) key exchange object using a
   * predefined curve specified by the `curveName` string. Use {@link getCurves} to obtain a list of available curve names. On recent
   * OpenSSL releases, `openssl ecparam -list_curves` will also display the name
   * and description of each available elliptic curve.
   */
  function createECDH(curveName: string): ECDH;
  /**
   * This function is based on a constant-time algorithm.
   * Returns true if `a` is equal to `b`, without leaking timing information that
   * would allow an attacker to guess one of the values. This is suitable for
   * comparing HMAC digests or secret values like authentication cookies or [capability urls](https://www.w3.org/TR/capability-urls/).
   *
   * `a` and `b` must both be `Buffer`s, `TypedArray`s, or `DataView`s, and they
   * must have the same byte length. An error is thrown if `a` and `b` have
   * different byte lengths.
   *
   * If at least one of `a` and `b` is a `TypedArray` with more than one byte per
   * entry, such as `Uint16Array`, the result will be computed using the platform
   * byte order.
   *
   * Use of `crypto.timingSafeEqual` does not guarantee that the _surrounding_ code
   * is timing-safe. Care should be taken to ensure that the surrounding code does
   * not introduce timing vulnerabilities.
   */
  function timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  /** @deprecated since v10.0.0 */
  const DEFAULT_ENCODING: BufferEncoding;
  type KeyType = 'rsa' | 'rsa-pss' | 'dsa' | 'ec' | 'ed25519' | 'ed448' | 'x25519' | 'x448';
  type KeyFormat = 'pem' | 'der';
  interface BasePrivateKeyEncodingOptions<T extends KeyFormat> {
      format: T;
      cipher?: string | undefined;
      passphrase?: string | undefined;
  }
  interface KeyPairKeyObjectResult {
      publicKey: KeyObject;
      privateKey: KeyObject;
  }
  interface ED25519KeyPairKeyObjectOptions {}
  interface ED448KeyPairKeyObjectOptions {}
  interface X25519KeyPairKeyObjectOptions {}
  interface X448KeyPairKeyObjectOptions {}
  interface ECKeyPairKeyObjectOptions {
      /**
       * Name of the curve to use
       */
      namedCurve: string;
  }
  interface RSAKeyPairKeyObjectOptions {
      /**
       * Key size in bits
       */
      modulusLength: number;
      /**
       * Public exponent
       * @default 0x10001
       */
      publicExponent?: number | undefined;
  }
  interface RSAPSSKeyPairKeyObjectOptions {
      /**
       * Key size in bits
       */
      modulusLength: number;
      /**
       * Public exponent
       * @default 0x10001
       */
      publicExponent?: number | undefined;
      /**
       * Name of the message digest
       */
      hashAlgorithm?: string;
      /**
       * Name of the message digest used by MGF1
       */
      mgf1HashAlgorithm?: string;
      /**
       * Minimal salt length in bytes
       */
      saltLength?: string;
  }
  interface DSAKeyPairKeyObjectOptions {
      /**
       * Key size in bits
       */
      modulusLength: number;
      /**
       * Size of q in bits
       */
      divisorLength: number;
  }
  interface RSAKeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      /**
       * Key size in bits
       */
      modulusLength: number;
      /**
       * Public exponent
       * @default 0x10001
       */
      publicExponent?: number | undefined;
      publicKeyEncoding: {
          type: 'pkcs1' | 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs1' | 'pkcs8';
      };
  }
  interface RSAPSSKeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      /**
       * Key size in bits
       */
      modulusLength: number;
      /**
       * Public exponent
       * @default 0x10001
       */
      publicExponent?: number | undefined;
      /**
       * Name of the message digest
       */
      hashAlgorithm?: string;
      /**
       * Name of the message digest used by MGF1
       */
      mgf1HashAlgorithm?: string;
      /**
       * Minimal salt length in bytes
       */
      saltLength?: string;
      publicKeyEncoding: {
          type: 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs8';
      };
  }
  interface DSAKeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      /**
       * Key size in bits
       */
      modulusLength: number;
      /**
       * Size of q in bits
       */
      divisorLength: number;
      publicKeyEncoding: {
          type: 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs8';
      };
  }
  interface ECKeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      /**
       * Name of the curve to use.
       */
      namedCurve: string;
      publicKeyEncoding: {
          type: 'pkcs1' | 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'sec1' | 'pkcs8';
      };
  }
  interface ED25519KeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      publicKeyEncoding: {
          type: 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs8';
      };
  }
  interface ED448KeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      publicKeyEncoding: {
          type: 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs8';
      };
  }
  interface X25519KeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      publicKeyEncoding: {
          type: 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs8';
      };
  }
  interface X448KeyPairOptions<PubF extends KeyFormat, PrivF extends KeyFormat> {
      publicKeyEncoding: {
          type: 'spki';
          format: PubF;
      };
      privateKeyEncoding: BasePrivateKeyEncodingOptions<PrivF> & {
          type: 'pkcs8';
      };
  }
  interface KeyPairSyncResult<T1 extends string | Buffer, T2 extends string | Buffer> {
      publicKey: T1;
      privateKey: T2;
  }
  /**
   * Generates a new asymmetric key pair of the given `type`. RSA, RSA-PSS, DSA, EC,
   * Ed25519, Ed448, X25519, X448, and DH are currently supported.
   *
   * If a `publicKeyEncoding` or `privateKeyEncoding` was specified, this function
   * behaves as if `keyObject.export()` had been called on its result. Otherwise,
   * the respective part of the key is returned as a `KeyObject`.
   *
   * When encoding public keys, it is recommended to use `'spki'`. When encoding
   * private keys, it is recommended to use `'pkcs8'` with a strong passphrase,
   * and to keep the passphrase confidential.
   *
   * ```js
   * const {
   *   generateKeyPairSync
   * } = await import('crypto');
   *
   * const {
   *   publicKey,
   *   privateKey,
   * } = generateKeyPairSync('rsa', {
   *   modulusLength: 4096,
   *   publicKeyEncoding: {
   *     type: 'spki',
   *     format: 'pem'
   *   },
   *   privateKeyEncoding: {
   *     type: 'pkcs8',
   *     format: 'pem',
   *     cipher: 'aes-256-cbc',
   *     passphrase: 'top secret'
   *   }
   * });
   * ```
   *
   * The return value `{ publicKey, privateKey }` represents the generated key pair.
   * When PEM encoding was selected, the respective key will be a string, otherwise
   * it will be a buffer containing the data encoded as DER.
   * @param type Must be `'rsa'`, `'rsa-pss'`, `'dsa'`, `'ec'`, `'ed25519'`, `'ed448'`, `'x25519'`, `'x448'`, or `'dh'`.
   */
  function generateKeyPairSync(type: 'rsa', options: RSAKeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'rsa', options: RSAKeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'rsa', options: RSAKeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'rsa', options: RSAKeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'rsa', options: RSAKeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'rsa-pss', options: RSAPSSKeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'dsa', options: DSAKeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'dsa', options: DSAKeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'dsa', options: DSAKeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'dsa', options: DSAKeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'dsa', options: DSAKeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'ec', options: ECKeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'ec', options: ECKeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'ec', options: ECKeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'ec', options: ECKeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'ec', options: ECKeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'ed25519', options: ED25519KeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'ed25519', options: ED25519KeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'ed25519', options: ED25519KeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'ed25519', options: ED25519KeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'ed25519', options?: ED25519KeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'ed448', options: ED448KeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'ed448', options: ED448KeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'ed448', options: ED448KeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'ed448', options: ED448KeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'ed448', options?: ED448KeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'x25519', options: X25519KeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'x25519', options: X25519KeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'x25519', options: X25519KeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'x25519', options: X25519KeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'x25519', options?: X25519KeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: 'x448', options: X448KeyPairOptions<'pem', 'pem'>): KeyPairSyncResult<string, string>;
  function generateKeyPairSync(type: 'x448', options: X448KeyPairOptions<'pem', 'der'>): KeyPairSyncResult<string, Buffer>;
  function generateKeyPairSync(type: 'x448', options: X448KeyPairOptions<'der', 'pem'>): KeyPairSyncResult<Buffer, string>;
  function generateKeyPairSync(type: 'x448', options: X448KeyPairOptions<'der', 'der'>): KeyPairSyncResult<Buffer, Buffer>;
  function generateKeyPairSync(type: 'x448', options?: X448KeyPairKeyObjectOptions): KeyPairKeyObjectResult;
  /**
   * Generates a new asymmetric key pair of the given `type`. RSA, RSA-PSS, DSA, EC,
   * Ed25519, Ed448, X25519, X448, and DH are currently supported.
   *
   * If a `publicKeyEncoding` or `privateKeyEncoding` was specified, this function
   * behaves as if `keyObject.export()` had been called on its result. Otherwise,
   * the respective part of the key is returned as a `KeyObject`.
   *
   * It is recommended to encode public keys as `'spki'` and private keys as`'pkcs8'` with encryption for long-term storage:
   *
   * ```js
   * const {
   *   generateKeyPair
   * } = await import('crypto');
   *
   * generateKeyPair('rsa', {
   *   modulusLength: 4096,
   *   publicKeyEncoding: {
   *     type: 'spki',
   *     format: 'pem'
   *   },
   *   privateKeyEncoding: {
   *     type: 'pkcs8',
   *     format: 'pem',
   *     cipher: 'aes-256-cbc',
   *     passphrase: 'top secret'
   *   }
   * }, (err, publicKey, privateKey) => {
   *   // Handle errors and use the generated key pair.
   * });
   * ```
   *
   * On completion, `callback` will be called with `err` set to `undefined` and`publicKey` / `privateKey` representing the generated key pair.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a `Promise` for an `Object` with `publicKey` and `privateKey` properties.
   * @param type Must be `'rsa'`, `'rsa-pss'`, `'dsa'`, `'ec'`, `'ed25519'`, `'ed448'`, `'x25519'`, `'x448'`, or `'dh'`.
   */
  function generateKeyPair(type: 'rsa', options: RSAKeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'rsa', options: RSAKeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'rsa', options: RSAKeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'rsa', options: RSAKeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'rsa', options: RSAKeyPairKeyObjectOptions, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'rsa-pss', options: RSAPSSKeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'rsa-pss', options: RSAPSSKeyPairKeyObjectOptions, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'dsa', options: DSAKeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'dsa', options: DSAKeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'dsa', options: DSAKeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'dsa', options: DSAKeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'dsa', options: DSAKeyPairKeyObjectOptions, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'ec', options: ECKeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'ec', options: ECKeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'ec', options: ECKeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'ec', options: ECKeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'ec', options: ECKeyPairKeyObjectOptions, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'ed25519', options: ED25519KeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'ed25519', options: ED25519KeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'ed25519', options: ED25519KeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'ed25519', options: ED25519KeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'ed25519', options: ED25519KeyPairKeyObjectOptions | undefined, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'ed448', options: ED448KeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'ed448', options: ED448KeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'ed448', options: ED448KeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'ed448', options: ED448KeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'ed448', options: ED448KeyPairKeyObjectOptions | undefined, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'x25519', options: X25519KeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'x25519', options: X25519KeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'x25519', options: X25519KeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'x25519', options: X25519KeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'x25519', options: X25519KeyPairKeyObjectOptions | undefined, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  function generateKeyPair(type: 'x448', options: X448KeyPairOptions<'pem', 'pem'>, callback: (err: Error | null, publicKey: string, privateKey: string) => void): void;
  function generateKeyPair(type: 'x448', options: X448KeyPairOptions<'pem', 'der'>, callback: (err: Error | null, publicKey: string, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'x448', options: X448KeyPairOptions<'der', 'pem'>, callback: (err: Error | null, publicKey: Buffer, privateKey: string) => void): void;
  function generateKeyPair(type: 'x448', options: X448KeyPairOptions<'der', 'der'>, callback: (err: Error | null, publicKey: Buffer, privateKey: Buffer) => void): void;
  function generateKeyPair(type: 'x448', options: X448KeyPairKeyObjectOptions | undefined, callback: (err: Error | null, publicKey: KeyObject, privateKey: KeyObject) => void): void;
  namespace generateKeyPair {
      function __promisify__(
          type: 'rsa',
          options: RSAKeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'rsa',
          options: RSAKeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'rsa',
          options: RSAKeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'rsa',
          options: RSAKeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'rsa', options: RSAKeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'rsa-pss',
          options: RSAPSSKeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'rsa-pss',
          options: RSAPSSKeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'rsa-pss',
          options: RSAPSSKeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'rsa-pss',
          options: RSAPSSKeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'rsa-pss', options: RSAPSSKeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'dsa',
          options: DSAKeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'dsa',
          options: DSAKeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'dsa',
          options: DSAKeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'dsa',
          options: DSAKeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'dsa', options: DSAKeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'ec',
          options: ECKeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'ec',
          options: ECKeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'ec',
          options: ECKeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'ec',
          options: ECKeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'ec', options: ECKeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'ed25519',
          options: ED25519KeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'ed25519',
          options: ED25519KeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'ed25519',
          options: ED25519KeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'ed25519',
          options: ED25519KeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'ed25519', options?: ED25519KeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'ed448',
          options: ED448KeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'ed448',
          options: ED448KeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'ed448',
          options: ED448KeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'ed448',
          options: ED448KeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'ed448', options?: ED448KeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'x25519',
          options: X25519KeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'x25519',
          options: X25519KeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'x25519',
          options: X25519KeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'x25519',
          options: X25519KeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'x25519', options?: X25519KeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
      function __promisify__(
          type: 'x448',
          options: X448KeyPairOptions<'pem', 'pem'>
      ): Promise<{
          publicKey: string;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'x448',
          options: X448KeyPairOptions<'pem', 'der'>
      ): Promise<{
          publicKey: string;
          privateKey: Buffer;
      }>;
      function __promisify__(
          type: 'x448',
          options: X448KeyPairOptions<'der', 'pem'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: string;
      }>;
      function __promisify__(
          type: 'x448',
          options: X448KeyPairOptions<'der', 'der'>
      ): Promise<{
          publicKey: Buffer;
          privateKey: Buffer;
      }>;
      function __promisify__(type: 'x448', options?: X448KeyPairKeyObjectOptions): Promise<KeyPairKeyObjectResult>;
  }
  /**
   * Calculates and returns the signature for `data` using the given private key and
   * algorithm. If `algorithm` is `null` or `undefined`, then the algorithm is
   * dependent upon the key type (especially Ed25519 and Ed448).
   *
   * If `key` is not a `KeyObject`, this function behaves as if `key` had been
   * passed to {@link createPrivateKey}. If it is an object, the following
   * additional properties can be passed:
   *
   * If the `callback` function is provided this function uses libuv's threadpool.
   */
  function sign(algorithm: string | null | undefined, data: ArrayBufferView, key: KeyLike | SignKeyObjectInput | SignPrivateKeyInput): Buffer;
  function sign(
      algorithm: string | null | undefined,
      data: ArrayBufferView,
      key: KeyLike | SignKeyObjectInput | SignPrivateKeyInput,
      callback: (error: Error | null, data: Buffer) => void
  ): void;
  /**
   * Verifies the given signature for `data` using the given key and algorithm. If`algorithm` is `null` or `undefined`, then the algorithm is dependent upon the
   * key type (especially Ed25519 and Ed448).
   *
   * If `key` is not a `KeyObject`, this function behaves as if `key` had been
   * passed to {@link createPublicKey}. If it is an object, the following
   * additional properties can be passed:
   *
   * The `signature` argument is the previously calculated signature for the `data`.
   *
   * Because public keys can be derived from private keys, a private key or a public
   * key may be passed for `key`.
   *
   * If the `callback` function is provided this function uses libuv's threadpool.
   */
  function verify(algorithm: string | null | undefined, data: ArrayBufferView, key: KeyLike | VerifyKeyObjectInput | VerifyPublicKeyInput, signature: ArrayBufferView): boolean;
  function verify(
      algorithm: string | null | undefined,
      data: ArrayBufferView,
      key: KeyLike | VerifyKeyObjectInput | VerifyPublicKeyInput,
      signature: ArrayBufferView,
      callback: (error: Error | null, result: boolean) => void
  ): void;
  /**
   * Computes the Diffie-Hellman secret based on a `privateKey` and a `publicKey`.
   * Both keys must have the same `asymmetricKeyType`, which must be one of `'dh'`(for Diffie-Hellman), `'ec'` (for ECDH), `'x448'`, or `'x25519'` (for ECDH-ES).
   */
  function diffieHellman(options: { privateKey: KeyObject; publicKey: KeyObject }): Buffer;
  type CipherMode = 'cbc' | 'ccm' | 'cfb' | 'ctr' | 'ecb' | 'gcm' | 'ocb' | 'ofb' | 'stream' | 'wrap' | 'xts';
  interface CipherInfoOptions {
      /**
       * A test key length.
       */
      keyLength?: number | undefined;
      /**
       * A test IV length.
       */
      ivLength?: number | undefined;
  }
  interface CipherInfo {
      /**
       * The name of the cipher.
       */
      name: string;
      /**
       * The nid of the cipher.
       */
      nid: number;
      /**
       * The block size of the cipher in bytes.
       * This property is omitted when mode is 'stream'.
       */
      blockSize?: number | undefined;
      /**
       * The expected or default initialization vector length in bytes.
       * This property is omitted if the cipher does not use an initialization vector.
       */
      ivLength?: number | undefined;
      /**
       * The expected or default key length in bytes.
       */
      keyLength: number;
      /**
       * The cipher mode.
       */
      mode: CipherMode;
  }
  /**
   * Returns information about a given cipher.
   *
   * Some ciphers accept variable length keys and initialization vectors. By default,
   * the `crypto.getCipherInfo()` method will return the default values for these
   * ciphers. To test if a given key length or iv length is acceptable for given
   * cipher, use the `keyLength` and `ivLength` options. If the given values are
   * unacceptable, `undefined` will be returned.
   * @param nameOrNid The name or nid of the cipher to query.
   */
  function getCipherInfo(nameOrNid: string | number, options?: CipherInfoOptions): CipherInfo | undefined;
  /**
   * HKDF is a simple key derivation function defined in RFC 5869\. The given `ikm`,`salt` and `info` are used with the `digest` to derive a key of `keylen` bytes.
   *
   * The supplied `callback` function is called with two arguments: `err` and`derivedKey`. If an errors occurs while deriving the key, `err` will be set;
   * otherwise `err` will be `null`. The successfully generated `derivedKey` will
   * be passed to the callback as an [ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer). An error will be thrown if any
   * of the input arguments specify invalid values or types.
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const {
   *   hkdf
   * } = await import('crypto');
   *
   * hkdf('sha512', 'key', 'salt', 'info', 64, (err, derivedKey) => {
   *   if (err) throw err;
   *   console.log(Buffer.from(derivedKey).toString('hex'));  // '24156e2...5391653'
   * });
   * ```
   * @param digest The digest algorithm to use.
   * @param ikm The input keying material. It must be at least one byte in length.
   * @param salt The salt value. Must be provided but can be zero-length.
   * @param info Additional info value. Must be provided but can be zero-length, and cannot be more than 1024 bytes.
   * @param keylen The length of the key to generate. Must be greater than 0. The maximum allowable value is `255` times the number of bytes produced by the selected digest function (e.g. `sha512`
   * generates 64-byte hashes, making the maximum HKDF output 16320 bytes).
   */
  function hkdf(digest: string, irm: BinaryLike | KeyObject, salt: BinaryLike, info: BinaryLike, keylen: number, callback: (err: Error | null, derivedKey: ArrayBuffer) => void): void;
  /**
   * Provides a synchronous HKDF key derivation function as defined in RFC 5869\. The
   * given `ikm`, `salt` and `info` are used with the `digest` to derive a key of`keylen` bytes.
   *
   * The successfully generated `derivedKey` will be returned as an [ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer).
   *
   * An error will be thrown if any of the input arguments specify invalid values or
   * types, or if the derived key cannot be generated.
   *
   * ```js
   * import { Buffer } from 'buffer';
   * const {
   *   hkdfSync
   * } = await import('crypto');
   *
   * const derivedKey = hkdfSync('sha512', 'key', 'salt', 'info', 64);
   * console.log(Buffer.from(derivedKey).toString('hex'));  // '24156e2...5391653'
   * ```
   * @param digest The digest algorithm to use.
   * @param ikm The input keying material. It must be at least one byte in length.
   * @param salt The salt value. Must be provided but can be zero-length.
   * @param info Additional info value. Must be provided but can be zero-length, and cannot be more than 1024 bytes.
   * @param keylen The length of the key to generate. Must be greater than 0. The maximum allowable value is `255` times the number of bytes produced by the selected digest function (e.g. `sha512`
   * generates 64-byte hashes, making the maximum HKDF output 16320 bytes).
   */
  function hkdfSync(digest: string, ikm: BinaryLike | KeyObject, salt: BinaryLike, info: BinaryLike, keylen: number): ArrayBuffer;
  interface SecureHeapUsage {
      /**
       * The total allocated secure heap size as specified using the `--secure-heap=n` command-line flag.
       */
      total: number;
      /**
       * The minimum allocation from the secure heap as specified using the `--secure-heap-min` command-line flag.
       */
      min: number;
      /**
       * The total number of bytes currently allocated from the secure heap.
       */
      used: number;
      /**
       * The calculated ratio of `used` to `total` allocated bytes.
       */
      utilization: number;
  }
  /**
   */
  function secureHeapUsed(): SecureHeapUsage;
  interface RandomUUIDOptions {
      /**
       * By default, to improve performance,
       * Node.js will pre-emptively generate and persistently cache enough
       * random data to generate up to 128 random UUIDs. To generate a UUID
       * without using the cache, set `disableEntropyCache` to `true`.
       *
       * @default `false`
       */
      disableEntropyCache?: boolean | undefined;
  }
  /**
   * Generates a random [RFC 4122](https://www.rfc-editor.org/rfc/rfc4122.txt) version 4 UUID. The UUID is generated using a
   * cryptographic pseudorandom number generator.
   */
  function randomUUID(options?: RandomUUIDOptions): string;
  interface X509CheckOptions {
      /**
       * @default 'always'
       */
      subject: 'always' | 'never';
      /**
       * @default true
       */
      wildcards: boolean;
      /**
       * @default true
       */
      partialWildcards: boolean;
      /**
       * @default false
       */
      multiLabelWildcards: boolean;
      /**
       * @default false
       */
      singleLabelSubdomains: boolean;
  }
  type LargeNumberLike = ArrayBufferView | SharedArrayBuffer | ArrayBuffer | bigint;
  interface GeneratePrimeOptions {
      add?: LargeNumberLike | undefined;
      rem?: LargeNumberLike | undefined;
      /**
       * @default false
       */
      safe?: boolean | undefined;
      bigint?: boolean | undefined;
  }
  interface GeneratePrimeOptionsBigInt extends GeneratePrimeOptions {
      bigint: true;
  }
  interface GeneratePrimeOptionsArrayBuffer extends GeneratePrimeOptions {
      bigint?: false | undefined;
  }
  /**
   * Generates a pseudorandom prime of `size` bits.
   *
   * If `options.safe` is `true`, the prime will be a safe prime -- that is,`(prime - 1) / 2` will also be a prime.
   *
   * The `options.add` and `options.rem` parameters can be used to enforce additional
   * requirements, e.g., for Diffie-Hellman:
   *
   * * If `options.add` and `options.rem` are both set, the prime will satisfy the
   * condition that `prime % add = rem`.
   * * If only `options.add` is set and `options.safe` is not `true`, the prime will
   * satisfy the condition that `prime % add = 1`.
   * * If only `options.add` is set and `options.safe` is set to `true`, the prime
   * will instead satisfy the condition that `prime % add = 3`. This is necessary
   * because `prime % add = 1` for `options.add > 2` would contradict the condition
   * enforced by `options.safe`.
   * * `options.rem` is ignored if `options.add` is not given.
   *
   * Both `options.add` and `options.rem` must be encoded as big-endian sequences
   * if given as an `ArrayBuffer`, `SharedArrayBuffer`, `TypedArray`, `Buffer`, or`DataView`.
   *
   * By default, the prime is encoded as a big-endian sequence of octets
   * in an [ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer). If the `bigint` option is `true`, then a
   * [bigint](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) is provided.
   * @param size The size (in bits) of the prime to generate.
   */
  function generatePrime(size: number, callback: (err: Error | null, prime: ArrayBuffer) => void): void;
  function generatePrime(size: number, options: GeneratePrimeOptionsBigInt, callback: (err: Error | null, prime: bigint) => void): void;
  function generatePrime(size: number, options: GeneratePrimeOptionsArrayBuffer, callback: (err: Error | null, prime: ArrayBuffer) => void): void;
  function generatePrime(size: number, options: GeneratePrimeOptions, callback: (err: Error | null, prime: ArrayBuffer | bigint) => void): void;
  /**
   * Generates a pseudorandom prime of `size` bits.
   *
   * If `options.safe` is `true`, the prime will be a safe prime -- that is,`(prime - 1) / 2` will also be a prime.
   *
   * The `options.add` and `options.rem` parameters can be used to enforce additional
   * requirements, e.g., for Diffie-Hellman:
   *
   * * If `options.add` and `options.rem` are both set, the prime will satisfy the
   * condition that `prime % add = rem`.
   * * If only `options.add` is set and `options.safe` is not `true`, the prime will
   * satisfy the condition that `prime % add = 1`.
   * * If only `options.add` is set and `options.safe` is set to `true`, the prime
   * will instead satisfy the condition that `prime % add = 3`. This is necessary
   * because `prime % add = 1` for `options.add > 2` would contradict the condition
   * enforced by `options.safe`.
   * * `options.rem` is ignored if `options.add` is not given.
   *
   * Both `options.add` and `options.rem` must be encoded as big-endian sequences
   * if given as an `ArrayBuffer`, `SharedArrayBuffer`, `TypedArray`, `Buffer`, or`DataView`.
   *
   * By default, the prime is encoded as a big-endian sequence of octets
   * in an [ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer). If the `bigint` option is `true`, then a
   * [bigint](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) is provided.
   * @param size The size (in bits) of the prime to generate.
   */
  function generatePrimeSync(size: number): ArrayBuffer;
  function generatePrimeSync(size: number, options: GeneratePrimeOptionsBigInt): bigint;
  function generatePrimeSync(size: number, options: GeneratePrimeOptionsArrayBuffer): ArrayBuffer;
  function generatePrimeSync(size: number, options: GeneratePrimeOptions): ArrayBuffer | bigint;
  interface CheckPrimeOptions {
      /**
       * The number of Miller-Rabin probabilistic primality iterations to perform.
       * When the value is 0 (zero), a number of checks is used that yields a false positive rate of at most 2-64 for random input.
       * Care must be used when selecting a number of checks.
       * Refer to the OpenSSL documentation for the BN_is_prime_ex function nchecks options for more details.
       *
       * @default 0
       */
      checks?: number | undefined;
  }
  /**
   * Checks the primality of the `candidate`.
   * @param candidate A possible prime encoded as a sequence of big endian octets of arbitrary length.
   */
  function checkPrime(value: LargeNumberLike, callback: (err: Error | null, result: boolean) => void): void;
  function checkPrime(value: LargeNumberLike, options: CheckPrimeOptions, callback: (err: Error | null, result: boolean) => void): void;
  /**
   * Checks the primality of the `candidate`.
   * @param candidate A possible prime encoded as a sequence of big endian octets of arbitrary length.
   * @return `true` if the candidate is a prime with an error probability less than `0.25 ** options.checks`.
   */
  function checkPrimeSync(candidate: LargeNumberLike, options?: CheckPrimeOptions): boolean;
}
declare module 'node:crypto' {
  export * from 'crypto';
}

// ./constants.d.ts

/** @deprecated use constants property exposed by the relevant module instead. */
declare module 'constants' {
  import { constants as osConstants, SignalConstants } from 'node:os';
  import { constants as cryptoConstants } from 'node:crypto';
  import { constants as fsConstants } from 'node:fs';

  const exp: typeof osConstants.errno &
      typeof osConstants.priority &
      SignalConstants &
      typeof cryptoConstants &
      typeof fsConstants;
  export = exp;
}

declare module 'node:constants' {
  import constants = require('constants');
  export = constants;
}

// ./url.d.ts

/**
 * The `url` module provides utilities for URL resolution and parsing. It can be
 * accessed using:
 *
 * ```js
 * import url from 'url';
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/url.js)
 */
 declare module 'url' {
  import { ClientRequestArgs } from 'node:http';
  import { ParsedUrlQuery, ParsedUrlQueryInput } from 'node:querystring';
  // Input to `url.format`
  interface UrlObject {
      auth?: string | null | undefined;
      hash?: string | null | undefined;
      host?: string | null | undefined;
      hostname?: string | null | undefined;
      href?: string | null | undefined;
      pathname?: string | null | undefined;
      protocol?: string | null | undefined;
      search?: string | null | undefined;
      slashes?: boolean | null | undefined;
      port?: string | number | null | undefined;
      query?: string | null | ParsedUrlQueryInput | undefined;
  }
  // Output of `url.parse`
  interface Url {
      auth: string | null;
      hash: string | null;
      host: string | null;
      hostname: string | null;
      href: string;
      path: string | null;
      pathname: string | null;
      protocol: string | null;
      search: string | null;
      slashes: boolean | null;
      port: string | null;
      query: string | null | ParsedUrlQuery;
  }
  interface UrlWithParsedQuery extends Url {
      query: ParsedUrlQuery;
  }
  interface UrlWithStringQuery extends Url {
      query: string | null;
  }
  /**
   * The `url.parse()` method takes a URL string, parses it, and returns a URL
   * object.
   *
   * A `TypeError` is thrown if `urlString` is not a string.
   *
   * A `URIError` is thrown if the `auth` property is present but cannot be decoded.
   *
   * Use of the legacy `url.parse()` method is discouraged. Users should
   * use the WHATWG `URL` API. Because the `url.parse()` method uses a
   * lenient, non-standard algorithm for parsing URL strings, security
   * issues can be introduced. Specifically, issues with [host name spoofing](https://hackerone.com/reports/678487) and
   * incorrect handling of usernames and passwords have been identified.
   *
   * Deprecation of this API has been shelved for now primarily due to the the
   * inability of the [WHATWG API to parse relative URLs](https://github.com/nodejs/node/issues/12682#issuecomment-1154492373).
   * [Discussions are ongoing](https://github.com/whatwg/url/issues/531) for the  best way to resolve this.
   *
   * @since v0.1.25
   * @param urlString The URL string to parse.
   * @param [parseQueryString=false] If `true`, the `query` property will always be set to an object returned by the {@link querystring} module's `parse()` method. If `false`, the `query` property
   * on the returned URL object will be an unparsed, undecoded string.
   * @param [slashesDenoteHost=false] If `true`, the first token after the literal string `//` and preceding the next `/` will be interpreted as the `host`. For instance, given `//foo/bar`, the
   * result would be `{host: 'foo', pathname: '/bar'}` rather than `{pathname: '//foo/bar'}`.
   */
  function parse(urlString: string): UrlWithStringQuery;
  function parse(urlString: string, parseQueryString: false | undefined, slashesDenoteHost?: boolean): UrlWithStringQuery;
  function parse(urlString: string, parseQueryString: true, slashesDenoteHost?: boolean): UrlWithParsedQuery;
  function parse(urlString: string, parseQueryString: boolean, slashesDenoteHost?: boolean): Url;
  /**
   * The `url.format()` method returns a formatted URL string derived from`urlObject`.
   *
   * ```js
   * const url = require('url');
   * url.format({
   *   protocol: 'https',
   *   hostname: 'example.com',
   *   pathname: '/some/path',
   *   query: {
   *     page: 1,
   *     format: 'json'
   *   }
   * });
   *
   * // => 'https://example.com/some/path?page=1&#x26;format=json'
   * ```
   *
   * If `urlObject` is not an object or a string, `url.format()` will throw a `TypeError`.
   *
   * The formatting process operates as follows:
   *
   * * A new empty string `result` is created.
   * * If `urlObject.protocol` is a string, it is appended as-is to `result`.
   * * Otherwise, if `urlObject.protocol` is not `undefined` and is not a string, an `Error` is thrown.
   * * For all string values of `urlObject.protocol` that _do not end_ with an ASCII
   * colon (`:`) character, the literal string `:` will be appended to `result`.
   * * If either of the following conditions is true, then the literal string `//`will be appended to `result`:
   *    * `urlObject.slashes` property is true;
   *    * `urlObject.protocol` begins with `http`, `https`, `ftp`, `gopher`, or`file`;
   * * If the value of the `urlObject.auth` property is truthy, and either`urlObject.host` or `urlObject.hostname` are not `undefined`, the value of`urlObject.auth` will be coerced into a string
   * and appended to `result`followed by the literal string `@`.
   * * If the `urlObject.host` property is `undefined` then:
   *    * If the `urlObject.hostname` is a string, it is appended to `result`.
   *    * Otherwise, if `urlObject.hostname` is not `undefined` and is not a string,
   *    an `Error` is thrown.
   *    * If the `urlObject.port` property value is truthy, and `urlObject.hostname`is not `undefined`:
   *          * The literal string `:` is appended to `result`, and
   *          * The value of `urlObject.port` is coerced to a string and appended to`result`.
   * * Otherwise, if the `urlObject.host` property value is truthy, the value of`urlObject.host` is coerced to a string and appended to `result`.
   * * If the `urlObject.pathname` property is a string that is not an empty string:
   *    * If the `urlObject.pathname`_does not start_ with an ASCII forward slash
   *    (`/`), then the literal string `'/'` is appended to `result`.
   *    * The value of `urlObject.pathname` is appended to `result`.
   * * Otherwise, if `urlObject.pathname` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.search` property is `undefined` and if the `urlObject.query`property is an `Object`, the literal string `?` is appended to `result`followed by the output of calling the
   * `querystring` module's `stringify()`method passing the value of `urlObject.query`.
   * * Otherwise, if `urlObject.search` is a string:
   *    * If the value of `urlObject.search`_does not start_ with the ASCII question
   *    mark (`?`) character, the literal string `?` is appended to `result`.
   *    * The value of `urlObject.search` is appended to `result`.
   * * Otherwise, if `urlObject.search` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.hash` property is a string:
   *    * If the value of `urlObject.hash`_does not start_ with the ASCII hash (`#`)
   *    character, the literal string `#` is appended to `result`.
   *    * The value of `urlObject.hash` is appended to `result`.
   * * Otherwise, if the `urlObject.hash` property is not `undefined` and is not a
   * string, an `Error` is thrown.
   * * `result` is returned.
   * @since v0.1.25
   * @deprecated Legacy: Use the WHATWG URL API instead.
   * @param urlObject A URL object (as returned by `url.parse()` or constructed otherwise). If a string, it is converted to an object by passing it to `url.parse()`.
   */
  function format(urlObject: URL, options?: URLFormatOptions): string;
  /**
   * The `url.format()` method returns a formatted URL string derived from`urlObject`.
   *
   * ```js
   * const url = require('url');
   * url.format({
   *   protocol: 'https',
   *   hostname: 'example.com',
   *   pathname: '/some/path',
   *   query: {
   *     page: 1,
   *     format: 'json'
   *   }
   * });
   *
   * // => 'https://example.com/some/path?page=1&#x26;format=json'
   * ```
   *
   * If `urlObject` is not an object or a string, `url.format()` will throw a `TypeError`.
   *
   * The formatting process operates as follows:
   *
   * * A new empty string `result` is created.
   * * If `urlObject.protocol` is a string, it is appended as-is to `result`.
   * * Otherwise, if `urlObject.protocol` is not `undefined` and is not a string, an `Error` is thrown.
   * * For all string values of `urlObject.protocol` that _do not end_ with an ASCII
   * colon (`:`) character, the literal string `:` will be appended to `result`.
   * * If either of the following conditions is true, then the literal string `//`will be appended to `result`:
   *    * `urlObject.slashes` property is true;
   *    * `urlObject.protocol` begins with `http`, `https`, `ftp`, `gopher`, or`file`;
   * * If the value of the `urlObject.auth` property is truthy, and either`urlObject.host` or `urlObject.hostname` are not `undefined`, the value of`urlObject.auth` will be coerced into a string
   * and appended to `result`followed by the literal string `@`.
   * * If the `urlObject.host` property is `undefined` then:
   *    * If the `urlObject.hostname` is a string, it is appended to `result`.
   *    * Otherwise, if `urlObject.hostname` is not `undefined` and is not a string,
   *    an `Error` is thrown.
   *    * If the `urlObject.port` property value is truthy, and `urlObject.hostname`is not `undefined`:
   *          * The literal string `:` is appended to `result`, and
   *          * The value of `urlObject.port` is coerced to a string and appended to`result`.
   * * Otherwise, if the `urlObject.host` property value is truthy, the value of`urlObject.host` is coerced to a string and appended to `result`.
   * * If the `urlObject.pathname` property is a string that is not an empty string:
   *    * If the `urlObject.pathname`_does not start_ with an ASCII forward slash
   *    (`/`), then the literal string `'/'` is appended to `result`.
   *    * The value of `urlObject.pathname` is appended to `result`.
   * * Otherwise, if `urlObject.pathname` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.search` property is `undefined` and if the `urlObject.query`property is an `Object`, the literal string `?` is appended to `result`followed by the output of calling the
   * `querystring` module's `stringify()`method passing the value of `urlObject.query`.
   * * Otherwise, if `urlObject.search` is a string:
   *    * If the value of `urlObject.search`_does not start_ with the ASCII question
   *    mark (`?`) character, the literal string `?` is appended to `result`.
   *    * The value of `urlObject.search` is appended to `result`.
   * * Otherwise, if `urlObject.search` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.hash` property is a string:
   *    * If the value of `urlObject.hash`_does not start_ with the ASCII hash (`#`)
   *    character, the literal string `#` is appended to `result`.
   *    * The value of `urlObject.hash` is appended to `result`.
   * * Otherwise, if the `urlObject.hash` property is not `undefined` and is not a
   * string, an `Error` is thrown.
   * * `result` is returned.
   * @since v0.1.25
   * @deprecated Legacy: Use the WHATWG URL API instead.
   * @param urlObject A URL object (as returned by `url.parse()` or constructed otherwise). If a string, it is converted to an object by passing it to `url.parse()`.
   */
  function format(urlObject: UrlObject | string): string;
  /**
   * The `url.resolve()` method resolves a target URL relative to a base URL in a
   * manner similar to that of a web browser resolving an anchor tag.
   *
   * ```js
   * const url = require('url');
   * url.resolve('/one/two/three', 'four');         // '/one/two/four'
   * url.resolve('http://example.com/', '/one');    // 'http://example.com/one'
   * url.resolve('http://example.com/one', '/two'); // 'http://example.com/two'
   * ```
   *
   * To achieve the same result using the WHATWG URL API:
   *
   * ```js
   * function resolve(from, to) {
   *   const resolvedUrl = new URL(to, new URL(from, 'resolve://'));
   *   if (resolvedUrl.protocol === 'resolve:') {
   *     // `from` is a relative URL.
   *     const { pathname, search, hash } = resolvedUrl;
   *     return pathname + search + hash;
   *   }
   *   return resolvedUrl.toString();
   * }
   *
   * resolve('/one/two/three', 'four');         // '/one/two/four'
   * resolve('http://example.com/', '/one');    // 'http://example.com/one'
   * resolve('http://example.com/one', '/two'); // 'http://example.com/two'
   * ```
   * @since v0.1.25
   * @deprecated Legacy: Use the WHATWG URL API instead.
   * @param from The base URL to use if `to` is a relative URL.
   * @param to The target URL to resolve.
   */
  function resolve(from: string, to: string): string;
  /**
   * This function ensures the correct decodings of percent-encoded characters as
   * well as ensuring a cross-platform valid absolute path string.
   *
   * ```js
   * import { fileURLToPath } from 'url';
   *
   * const __filename = fileURLToPath(import.meta.url);
   *
   * new URL('file:///C:/path/').pathname;      // Incorrect: /C:/path/
   * fileURLToPath('file:///C:/path/');         // Correct:   C:\path\ (Windows)
   *
   * new URL('file://nas/foo.txt').pathname;    // Incorrect: /foo.txt
   * fileURLToPath('file://nas/foo.txt');       // Correct:   \\nas\foo.txt (Windows)
   *
   * new URL('file:///你好.txt').pathname;      // Incorrect: /%E4%BD%A0%E5%A5%BD.txt
   * fileURLToPath('file:///你好.txt');         // Correct:   /你好.txt (POSIX)
   *
   * new URL('file:///hello world').pathname;   // Incorrect: /hello%20world
   * fileURLToPath('file:///hello world');      // Correct:   /hello world (POSIX)
   * ```
   * @since v10.12.0
   * @param url The file URL string or URL object to convert to a path.
   * @return The fully-resolved platform-specific Node.js file path.
   */
  function fileURLToPath(url: string | URL): string;
  /**
   * This function ensures that `path` is resolved absolutely, and that the URL
   * control characters are correctly encoded when converting into a File URL.
   *
   * ```js
   * import { pathToFileURL } from 'url';
   *
   * new URL('/foo#1', 'file:');           // Incorrect: file:///foo#1
   * pathToFileURL('/foo#1');              // Correct:   file:///foo%231 (POSIX)
   *
   * new URL('/some/path%.c', 'file:');    // Incorrect: file:///some/path%.c
   * pathToFileURL('/some/path%.c');       // Correct:   file:///some/path%25.c (POSIX)
   * ```
   * @since v10.12.0
   * @param path The path to convert to a File URL.
   * @return The file URL object.
   */
  function pathToFileURL(path: string): URL;
  interface URLFormatOptions {
      auth?: boolean | undefined;
      fragment?: boolean | undefined;
      search?: boolean | undefined;
      unicode?: boolean | undefined;
  }

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
    /** Returns a string containing a query string suitable for use in a URL. Does not include the question mark. */
    toString(): string;
    forEach(
      callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
      thisArg?: any
    ): void;
  }
}

declare module 'node:url' {
  export * from 'url';
}

// ./tty.d.ts


declare module 'tty' {
  /**
   * The `tty.isatty()` method returns `true` if the given `fd` is associated with
   * a TTY and `false` if it is not, including whenever `fd` is not a non-negative
   * integer.
   * @since v0.5.8
   * @param fd A numeric file descriptor
   */
  function isatty(fd: number): boolean;

  // TODO: tty-browserify only polyfills functions that throws errors, wouldn't make sense to have types at the moment
  var ReadStream: Function;
  var WriteStream: Function;
}
declare module 'node:tty' {
    export * from 'tty';
}

// ./http.d.ts

/**
 * To use the HTTP server and client one must `require('http')`.
 *
 * The HTTP interfaces in Node.js are designed to support many features
 * of the protocol which have been traditionally difficult to use.
 * In particular, large, possibly chunk-encoded, messages. The interface is
 * careful to never buffer entire requests or responses, so the
 * user is able to stream data.
 *
 * HTTP message headers are represented by an object like this:
 *
 * ```js
 * { 'content-length': '123',
 *   'content-type': 'text/plain',
 *   'connection': 'keep-alive',
 *   'host': 'example.com',
 *   'accept': '*' }
 * ```
 *
 * Keys are lowercased. Values are not modified.
 *
 * In order to support the full spectrum of possible HTTP applications, the Node.js
 * HTTP API is very low-level. It deals with stream handling and message
 * parsing only. It parses a message into headers and body but it does not
 * parse the actual headers or the body.
 *
 * See `message.headers` for details on how duplicate headers are handled.
 *
 * The raw headers as they were received are retained in the `rawHeaders`property, which is an array of `[key, value, key2, value2, ...]`. For
 * example, the previous message header object might have a `rawHeaders`list like the following:
 *
 * ```js
 * [ 'ConTent-Length', '123456',
 *   'content-LENGTH', '123',
 *   'content-type', 'text/plain',
 *   'CONNECTION', 'keep-alive',
 *   'Host', 'example.com',
 *   'accepT', '*' ]
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/http.js)
 */
 declare module 'http' {
  import * as stream from 'node:stream';
  // incoming headers will never contain number
  interface IncomingHttpHeaders extends Dict<string | string[]> {
      accept?: string | undefined;
      'accept-language'?: string | undefined;
      'accept-patch'?: string | undefined;
      'accept-ranges'?: string | undefined;
      'access-control-allow-credentials'?: string | undefined;
      'access-control-allow-headers'?: string | undefined;
      'access-control-allow-methods'?: string | undefined;
      'access-control-allow-origin'?: string | undefined;
      'access-control-expose-headers'?: string | undefined;
      'access-control-max-age'?: string | undefined;
      'access-control-request-headers'?: string | undefined;
      'access-control-request-method'?: string | undefined;
      age?: string | undefined;
      allow?: string | undefined;
      'alt-svc'?: string | undefined;
      authorization?: string | undefined;
      'cache-control'?: string | undefined;
      connection?: string | undefined;
      'content-disposition'?: string | undefined;
      'content-encoding'?: string | undefined;
      'content-language'?: string | undefined;
      'content-length'?: string | undefined;
      'content-location'?: string | undefined;
      'content-range'?: string | undefined;
      'content-type'?: string | undefined;
      cookie?: string | undefined;
      date?: string | undefined;
      etag?: string | undefined;
      expect?: string | undefined;
      expires?: string | undefined;
      forwarded?: string | undefined;
      from?: string | undefined;
      host?: string | undefined;
      'if-match'?: string | undefined;
      'if-modified-since'?: string | undefined;
      'if-none-match'?: string | undefined;
      'if-unmodified-since'?: string | undefined;
      'last-modified'?: string | undefined;
      location?: string | undefined;
      origin?: string | undefined;
      pragma?: string | undefined;
      'proxy-authenticate'?: string | undefined;
      'proxy-authorization'?: string | undefined;
      'public-key-pins'?: string | undefined;
      range?: string | undefined;
      referer?: string | undefined;
      'retry-after'?: string | undefined;
      'sec-websocket-accept'?: string | undefined;
      'sec-websocket-extensions'?: string | undefined;
      'sec-websocket-key'?: string | undefined;
      'sec-websocket-protocol'?: string | undefined;
      'sec-websocket-version'?: string | undefined;
      'set-cookie'?: string[] | undefined;
      'strict-transport-security'?: string | undefined;
      tk?: string | undefined;
      trailer?: string | undefined;
      'transfer-encoding'?: string | undefined;
      upgrade?: string | undefined;
      'user-agent'?: string | undefined;
      vary?: string | undefined;
      via?: string | undefined;
      warning?: string | undefined;
      'www-authenticate'?: string | undefined;
  }
  // outgoing headers allows numbers (as they are converted internally to strings)
  type OutgoingHttpHeader = number | string | string[];
  interface OutgoingHttpHeaders extends Dict<OutgoingHttpHeader> {}
  interface ClientRequestArgs {
      signal?: AbortSignal | undefined;
      protocol?: string | null | undefined;
      host?: string | null | undefined;
      hostname?: string | null | undefined;
      family?: number | undefined;
      port?: number | string | null | undefined;
      defaultPort?: number | string | undefined;
      localAddress?: string | undefined;
      socketPath?: string | undefined;
      /**
       * @default 8192
       */
      maxHeaderSize?: number | undefined;
      method?: string | undefined;
      path?: string | null | undefined;
      headers?: OutgoingHttpHeaders | undefined;
      auth?: string | null | undefined;
      timeout?: number | undefined;
      setHost?: boolean | undefined;
  }
  interface InformationEvent {
      statusCode: number;
      statusMessage: string;
      httpVersion: string;
      httpVersionMajor: number;
      httpVersionMinor: number;
      headers: IncomingHttpHeaders;
      rawHeaders: string[];
  }
  /**
   * This object is created internally and returned from {@link request}. It
   * represents an _in-progress_ request whose header has already been queued. The
   * header is still mutable using the `setHeader(name, value)`,`getHeader(name)`, `removeHeader(name)` API. The actual header will
   * be sent along with the first data chunk or when calling `request.end()`.
   *
   * To get the response, add a listener for `'response'` to the request object.`'response'` will be emitted from the request object when the response
   * headers have been received. The `'response'` event is executed with one
   * argument which is an instance of {@link IncomingMessage}.
   *
   * During the `'response'` event, one can add listeners to the
   * response object; particularly to listen for the `'data'` event.
   *
   * If no `'response'` handler is added, then the response will be
   * entirely discarded. However, if a `'response'` event handler is added,
   * then the data from the response object **must** be consumed, either by
   * calling `response.read()` whenever there is a `'readable'` event, or
   * by adding a `'data'` handler, or by calling the `.resume()` method.
   * Until the data is consumed, the `'end'` event will not fire. Also, until
   * the data is read it will consume memory that can eventually lead to a
   * 'process out of memory' error.
   *
   * For backward compatibility, `res` will only emit `'error'` if there is an`'error'` listener registered.
   *
   * Node.js does not check whether Content-Length and the length of the
   * body which has been transmitted are equal or not.
   */
  class ClientRequest {
      /**
       * The `request.aborted` property will be `true` if the request has
       * been aborted.
       * @deprecated Since v17.0.0,v16.12.0 - Check `destroyed` instead.
       */
      aborted: boolean;
      /**
       * The request host.
       */
      host: string;
      /**
       * The request protocol.
       */
      protocol: string;
      /**
       * When sending request through a keep-alive enabled agent, the underlying socket
       * might be reused. But if server closes connection at unfortunate time, client
       * may run into a 'ECONNRESET' error.
       *
       * ```js
       * const http = require('http');
       *
       * // Server has a 5 seconds keep-alive timeout by default
       * http
       *   .createServer((req, res) => {
       *     res.write('hello\n');
       *     res.end();
       *   })
       *   .listen(3000);
       *
       * setInterval(() => {
       *   // Adapting a keep-alive agent
       *   http.get('http://localhost:3000', { agent }, (res) => {
       *     res.on('data', (data) => {
       *       // Do nothing
       *     });
       *   });
       * }, 5000); // Sending request on 5s interval so it's easy to hit idle timeout
       * ```
       *
       * By marking a request whether it reused socket or not, we can do
       * automatic error retry base on it.
       *
       * ```js
       * const http = require('http');
       * const agent = new http.Agent({ keepAlive: true });
       *
       * function retriableRequest() {
       *   const req = http
       *     .get('http://localhost:3000', { agent }, (res) => {
       *       // ...
       *     })
       *     .on('error', (err) => {
       *       // Check if retry is needed
       *       if (req.reusedSocket &#x26;&#x26; err.code === 'ECONNRESET') {
       *         retriableRequest();
       *       }
       *     });
       * }
       *
       * retriableRequest();
       * ```
       */
      reusedSocket: boolean;
      /**
       * Limits maximum response headers count. If set to 0, no limit will be applied.
       */
      maxHeadersCount: number;
      constructor(url: string | URL | ClientRequestArgs, cb?: (res: IncomingMessage) => void);
      /**
       * The request method.
       */
      method: string;
      /**
       * The request path.
       */
      path: string;
      /**
       * Marks the request as aborting. Calling this will cause remaining data
       * in the response to be dropped and the socket to be destroyed.
       * @deprecated Since v14.1.0,v13.14.0 - Use `destroy` instead.
       */
      abort(): void;
      /**
       * Once a socket is assigned to this request and is connected `socket.setTimeout()` will be called.
       * @param timeout Milliseconds before a request times out.
       * @param callback Optional function to be called when a timeout occurs. Same as binding to the `'timeout'` event.
       */
      setTimeout(timeout: number, callback?: () => void): this;
      /**
       * Sets a single header value for the header object.
       * @param name Header name
       * @param value Header value
       */
      setHeader(name: string, value: number | string | ReadonlyArray<string>): this;
      /**
       * Gets the value of HTTP header with the given name. If such a name doesn't
       * exist in message, it will be `undefined`.
       * @param name Name of header
       */
      getHeader(name: string): number | string | string[] | undefined;
      /**
       * Removes a header that is queued for implicit sending.
       *
       * ```js
       * outgoingMessage.removeHeader('Content-Encoding');
       * ```
       * @param name Header name
       */
      removeHeader(name: string): void;
      /**
       * Compulsorily flushes the message headers
       *
       * For efficiency reason, Node.js normally buffers the message headers
       * until `outgoingMessage.end()` is called or the first chunk of message data
       * is written. It then tries to pack the headers and data into a single TCP
       * packet.
       *
       * It is usually desired (it saves a TCP round-trip), but not when the first
       * data is not sent until possibly much later. `outgoingMessage.flushHeaders()`bypasses the optimization and kickstarts the request.
       */
      flushHeaders(): void;
      /**
       * Once a socket is assigned to this request and is connected `socket.setNoDelay()` will be called.
       */
      setNoDelay(noDelay?: boolean): void;
      /**
       * Once a socket is assigned to this request and is connected `socket.setKeepAlive()` will be called.
       */
      setSocketKeepAlive(enable?: boolean, initialDelay?: number): void;
      /**
       * Returns an array containing the unique names of the current outgoing raw
       * headers. Header names are returned with their exact casing being set.
       *
       * ```js
       * request.setHeader('Foo', 'bar');
       * request.setHeader('Set-Cookie', ['foo=bar', 'bar=baz']);
       *
       * const headerNames = request.getRawHeaderNames();
       * // headerNames === ['Foo', 'Set-Cookie']
       * ```
       */
      getRawHeaderNames(): string[];
      /**
       * @deprecated
       */
      addListener(event: 'abort', listener: () => void): this;
      addListener(event: 'continue', listener: () => void): this;
      addListener(event: 'information', listener: (info: InformationEvent) => void): this;
      addListener(event: 'response', listener: (response: IncomingMessage) => void): this;
      addListener(event: 'timeout', listener: () => void): this;
      addListener(event: 'close', listener: () => void): this;
      addListener(event: 'drain', listener: () => void): this;
      addListener(event: 'error', listener: (err: Error) => void): this;
      addListener(event: 'finish', listener: () => void): this;
      addListener(event: 'pipe', listener: (src: stream.Readable) => void): this;
      addListener(event: 'unpipe', listener: (src: stream.Readable) => void): this;
      addListener(event: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * @deprecated
       */
      on(event: 'abort', listener: () => void): this;
      on(event: 'continue', listener: () => void): this;
      on(event: 'information', listener: (info: InformationEvent) => void): this;
      on(event: 'response', listener: (response: IncomingMessage) => void): this;
      on(event: 'timeout', listener: () => void): this;
      on(event: 'close', listener: () => void): this;
      on(event: 'drain', listener: () => void): this;
      on(event: 'error', listener: (err: Error) => void): this;
      on(event: 'finish', listener: () => void): this;
      on(event: 'pipe', listener: (src: stream.Readable) => void): this;
      on(event: 'unpipe', listener: (src: stream.Readable) => void): this;
      on(event: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * @deprecated
       */
      once(event: 'abort', listener: () => void): this;
      once(event: 'continue', listener: () => void): this;
      once(event: 'information', listener: (info: InformationEvent) => void): this;
      once(event: 'response', listener: (response: IncomingMessage) => void): this;
      once(event: 'timeout', listener: () => void): this;
      once(event: 'close', listener: () => void): this;
      once(event: 'drain', listener: () => void): this;
      once(event: 'error', listener: (err: Error) => void): this;
      once(event: 'finish', listener: () => void): this;
      once(event: 'pipe', listener: (src: stream.Readable) => void): this;
      once(event: 'unpipe', listener: (src: stream.Readable) => void): this;
      once(event: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * @deprecated
       */
      prependListener(event: 'abort', listener: () => void): this;
      prependListener(event: 'continue', listener: () => void): this;
      prependListener(event: 'information', listener: (info: InformationEvent) => void): this;
      prependListener(event: 'response', listener: (response: IncomingMessage) => void): this;
      prependListener(event: 'timeout', listener: () => void): this;
      prependListener(event: 'close', listener: () => void): this;
      prependListener(event: 'drain', listener: () => void): this;
      prependListener(event: 'error', listener: (err: Error) => void): this;
      prependListener(event: 'finish', listener: () => void): this;
      prependListener(event: 'pipe', listener: (src: stream.Readable) => void): this;
      prependListener(event: 'unpipe', listener: (src: stream.Readable) => void): this;
      prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
      /**
       * @deprecated
       */
      prependOnceListener(event: 'abort', listener: () => void): this;
      prependOnceListener(event: 'continue', listener: () => void): this;
      prependOnceListener(event: 'information', listener: (info: InformationEvent) => void): this;
      prependOnceListener(event: 'response', listener: (response: IncomingMessage) => void): this;
      prependOnceListener(event: 'timeout', listener: () => void): this;
      prependOnceListener(event: 'close', listener: () => void): this;
      prependOnceListener(event: 'drain', listener: () => void): this;
      prependOnceListener(event: 'error', listener: (err: Error) => void): this;
      prependOnceListener(event: 'finish', listener: () => void): this;
      prependOnceListener(event: 'pipe', listener: (src: stream.Readable) => void): this;
      prependOnceListener(event: 'unpipe', listener: (src: stream.Readable) => void): this;
      prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
  }
  /**
   * An `IncomingMessage` object is created by {@link Server} or {@link ClientRequest} and passed as the first argument to the `'request'` and `'response'` event respectively. It may be used to
   * access response
   * status, headers and data.
   *
   * Different from its `socket` value which is a subclass of `stream.Duplex`, the`IncomingMessage` itself extends `stream.Readable` and is created separately to
   * parse and emit the incoming HTTP headers and payload, as the underlying socket
   * may be reused multiple times in case of keep-alive.
   */
  class IncomingMessage extends stream.Readable {
      /**
       * The `message.aborted` property will be `true` if the request has
       * been aborted.
       * @deprecated Since v17.0.0,v16.12.0 - Check `message.destroyed` from <a href="stream.html#class-streamreadable" class="type">stream.Readable</a>.
       */
      aborted: boolean;
      /**
       * In case of server request, the HTTP version sent by the client. In the case of
       * client response, the HTTP version of the connected-to server.
       * Probably either `'1.1'` or `'1.0'`.
       *
       * Also `message.httpVersionMajor` is the first integer and`message.httpVersionMinor` is the second.
       */
      httpVersion: string;
      httpVersionMajor: number;
      httpVersionMinor: number;
      /**
       * The `message.complete` property will be `true` if a complete HTTP message has
       * been received and successfully parsed.
       *
       * This property is particularly useful as a means of determining if a client or
       * server fully transmitted a message before a connection was terminated:
       *
       * ```js
       * const req = http.request({
       *   host: '127.0.0.1',
       *   port: 8080,
       *   method: 'POST'
       * }, (res) => {
       *   res.resume();
       *   res.on('end', () => {
       *     if (!res.complete)
       *       console.error(
       *         'The connection was terminated while the message was still being sent');
       *   });
       * });
       * ```
       */
      complete: boolean;
      /**
       * The request/response headers object.
       *
       * Key-value pairs of header names and values. Header names are lower-cased.
       *
       * ```js
       * // Prints something like:
       * //
       * // { 'user-agent': 'curl/7.22.0',
       * //   host: '127.0.0.1:8000',
       * //   accept: '*' }
       * console.log(request.getHeaders());
       * ```
       *
       * Duplicates in raw headers are handled in the following ways, depending on the
       * header name:
       *
       * * Duplicates of `age`, `authorization`, `content-length`, `content-type`,`etag`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`,`last-modified`, `location`,
       * `max-forwards`, `proxy-authorization`, `referer`,`retry-after`, `server`, or `user-agent` are discarded.
       * * `set-cookie` is always an array. Duplicates are added to the array.
       * * For duplicate `cookie` headers, the values are joined together with '; '.
       * * For all other headers, the values are joined together with ', '.
       */
      headers: IncomingHttpHeaders;
      /**
       * The raw request/response headers list exactly as they were received.
       *
       * The keys and values are in the same list. It is _not_ a
       * list of tuples. So, the even-numbered offsets are key values, and the
       * odd-numbered offsets are the associated values.
       *
       * Header names are not lowercased, and duplicates are not merged.
       *
       * ```js
       * // Prints something like:
       * //
       * // [ 'user-agent',
       * //   'this is invalid because there can be only one',
       * //   'User-Agent',
       * //   'curl/7.22.0',
       * //   'Host',
       * //   '127.0.0.1:8000',
       * //   'ACCEPT',
       * //   '*' ]
       * console.log(request.rawHeaders);
       * ```
       */
      rawHeaders: string[];
      /**
       * The request/response trailers object. Only populated at the `'end'` event.
       */
      trailers: Dict<string>;
      /**
       * The raw request/response trailer keys and values exactly as they were
       * received. Only populated at the `'end'` event.
       */
      rawTrailers: string[];
      /**
       * Calls `message.socket.setTimeout(msecs, callback)`.
       */
      setTimeout(msecs: number, callback?: () => void): this;
      /**
       * **Only valid for request obtained from {@link Server}.**
       *
       * The request method as a string. Read only. Examples: `'GET'`, `'DELETE'`.
       */
      method?: string | undefined;
      /**
       * **Only valid for request obtained from {@link Server}.**
       *
       * Request URL string. This contains only the URL that is present in the actual
       * HTTP request. Take the following request:
       *
       * ```http
       * GET /status?name=ryan HTTP/1.1
       * Accept: text/plain
       * ```
       *
       * To parse the URL into its parts:
       *
       * ```js
       * new URL(request.url, `http://${request.getHeaders().host}`);
       * ```
       *
       * When `request.url` is `'/status?name=ryan'` and`request.getHeaders().host` is `'localhost:3000'`:
       *
       * ```console
       * $ node
       * > new URL(request.url, `http://${request.getHeaders().host}`)
       * URL {
       *   href: 'http://localhost:3000/status?name=ryan',
       *   origin: 'http://localhost:3000',
       *   protocol: 'http:',
       *   username: '',
       *   password: '',
       *   host: 'localhost:3000',
       *   hostname: 'localhost',
       *   port: '3000',
       *   pathname: '/status',
       *   search: '?name=ryan',
       *   searchParams: URLSearchParams { 'name' => 'ryan' },
       *   hash: ''
       * }
       * ```
       */
      url?: string | undefined;
      /**
       * **Only valid for response obtained from {@link ClientRequest}.**
       *
       * The 3-digit HTTP response status code. E.G. `404`.
       */
      statusCode?: number | undefined;
      /**
       * **Only valid for response obtained from {@link ClientRequest}.**
       *
       * The HTTP response status message (reason phrase). E.G. `OK` or `Internal Server Error`.
       */
      statusMessage?: string | undefined;
      /**
       * Calls `destroy()` on the socket that received the `IncomingMessage`. If `error`is provided, an `'error'` event is emitted on the socket and `error` is passed
       * as an argument to any listeners on the event.
       */
      destroy(error?: Error): this;
  }
  const METHODS: string[];
  const STATUS_CODES: {
      [errorCode: number]: string | undefined;
      [errorCode: string]: string | undefined;
  };
  // although RequestOptions are passed as ClientRequestArgs to ClientRequest directly,
  // create interface RequestOptions would make the naming more clear to developers
  interface RequestOptions extends ClientRequestArgs {}
  /**
   * `options` in `socket.connect()` are also supported.
   *
   * Node.js maintains several connections per server to make HTTP requests.
   * This function allows one to transparently issue requests.
   *
   * `url` can be a string or a `URL` object. If `url` is a
   * string, it is automatically parsed with `new URL()`. If it is a `URL` object, it will be automatically converted to an ordinary `options` object.
   *
   * If both `url` and `options` are specified, the objects are merged, with the`options` properties taking precedence.
   *
   * The optional `callback` parameter will be added as a one-time listener for
   * the `'response'` event.
   *
   * `http.request()` returns an instance of the {@link ClientRequest} class. The `ClientRequest` instance is a writable stream. If one needs to
   * upload a file with a POST request, then write to the `ClientRequest` object.
   *
   * ```js
   * const http = require('http');
   *
   * const postData = JSON.stringify({
   *   'msg': 'Hello World!'
   * });
   *
   * const options = {
   *   hostname: 'www.google.com',
   *   port: 80,
   *   path: '/upload',
   *   method: 'POST',
   *   headers: {
   *     'Content-Type': 'application/json',
   *     'Content-Length': Buffer.byteLength(postData)
   *   }
   * };
   *
   * const req = http.request(options, (res) => {
   *   console.log(`STATUS: ${res.statusCode}`);
   *   console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
   *   res.setEncoding('utf8');
   *   res.on('data', (chunk) => {
   *     console.log(`BODY: ${chunk}`);
   *   });
   *   res.on('end', () => {
   *     console.log('No more data in response.');
   *   });
   * });
   *
   * req.on('error', (e) => {
   *   console.error(`problem with request: ${e.message}`);
   * });
   *
   * // Write data to request body
   * req.write(postData);
   * req.end();
   * ```
   *
   * In the example `req.end()` was called. With `http.request()` one
   * must always call `req.end()` to signify the end of the request -
   * even if there is no data being written to the request body.
   *
   * If any error is encountered during the request (be that with DNS resolution,
   * TCP level errors, or actual HTTP parse errors) an `'error'` event is emitted
   * on the returned request object. As with all `'error'` events, if no listeners
   * are registered the error will be thrown.
   *
   * There are a few special headers that should be noted.
   *
   * * Sending a 'Connection: keep-alive' will notify Node.js that the connection to
   * the server should be persisted until the next request.
   * * Sending a 'Content-Length' header will disable the default chunked encoding.
   * * Sending an 'Expect' header will immediately send the request headers.
   * Usually, when sending 'Expect: 100-continue', both a timeout and a listener
   * for the `'continue'` event should be set. See RFC 2616 Section 8.2.3 for more
   * information.
   * * Sending an Authorization header will override using the `auth` option
   * to compute basic authentication.
   *
   * Example using a `URL` as `options`:
   *
   * ```js
   * const options = new URL('http://abc:xyz@example.com');
   *
   * const req = http.request(options, (res) => {
   *   // ...
   * });
   * ```
   *
   * In a successful request, the following events will be emitted in the following
   * order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   *    (`'data'` will not be emitted at all if the response body is empty, for
   *    instance, in most redirects)
   *    * `'end'` on the `res` object
   * * `'close'`
   *
   * In the case of a connection error, the following events will be emitted:
   *
   * * `'socket'`
   * * `'error'`
   * * `'close'`
   *
   * In the case of a premature connection close before the response is received,
   * the following events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * In the case of a premature connection close after the response is received,
   * the following events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   * * (connection closed here)
   * * `'aborted'` on the `res` object
   * * `'error'` on the `res` object with an error with message`'Error: aborted'` and code `'ECONNRESET'`.
   * * `'close'`
   * * `'close'` on the `res` object
   *
   * If `req.destroy()` is called before a socket is assigned, the following
   * events will be emitted in the following order:
   *
   * * (`req.destroy()` called here)
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * If `req.destroy()` is called before the connection succeeds, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * (`req.destroy()` called here)
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * If `req.destroy()` is called after the response is received, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   * * (`req.destroy()` called here)
   * * `'aborted'` on the `res` object
   * * `'error'` on the `res` object with an error with message`'Error: aborted'` and code `'ECONNRESET'`.
   * * `'close'`
   * * `'close'` on the `res` object
   *
   * If `req.abort()` is called before a socket is assigned, the following
   * events will be emitted in the following order:
   *
   * * (`req.abort()` called here)
   * * `'abort'`
   * * `'close'`
   *
   * If `req.abort()` is called before the connection succeeds, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * (`req.abort()` called here)
   * * `'abort'`
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * If `req.abort()` is called after the response is received, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   * * (`req.abort()` called here)
   * * `'abort'`
   * * `'aborted'` on the `res` object
   * * `'error'` on the `res` object with an error with message`'Error: aborted'` and code `'ECONNRESET'`.
   * * `'close'`
   * * `'close'` on the `res` object
   *
   * Setting the `timeout` option or using the `setTimeout()` function will
   * not abort the request or do anything besides add a `'timeout'` event.
   *
   * Passing an `AbortSignal` and then calling `abort` on the corresponding`AbortController` will behave the same way as calling `.destroy()` on the
   * request itself.
   */
  function request(options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void): ClientRequest;
  function request(url: string | URL, options: RequestOptions, callback?: (res: IncomingMessage) => void): ClientRequest;
  /**
   * Since most requests are GET requests without bodies, Node.js provides this
   * convenience method. The only difference between this method and {@link request} is that it sets the method to GET and calls `req.end()`automatically. The callback must take care to consume the
   * response
   * data for reasons stated in {@link ClientRequest} section.
   *
   * The `callback` is invoked with a single argument that is an instance of {@link IncomingMessage}.
   *
   * JSON fetching example:
   *
   * ```js
   * http.get('http://localhost:8000/', (res) => {
   *   const { statusCode } = res;
   *   const contentType = res.headers['content-type'];
   *
   *   let error;
   *   // Any 2xx status code signals a successful response but
   *   // here we're only checking for 200.
   *   if (statusCode !== 200) {
   *     error = new Error('Request Failed.\n' +
   *                       `Status Code: ${statusCode}`);
   *   } else if (!/^application\/json/.test(contentType)) {
   *     error = new Error('Invalid content-type.\n' +
   *                       `Expected application/json but received ${contentType}`);
   *   }
   *   if (error) {
   *     console.error(error.message);
   *     // Consume response data to free up memory
   *     res.resume();
   *     return;
   *   }
   *
   *   res.setEncoding('utf8');
   *   let rawData = '';
   *   res.on('data', (chunk) => { rawData += chunk; });
   *   res.on('end', () => {
   *     try {
   *       const parsedData = JSON.parse(rawData);
   *       console.log(parsedData);
   *     } catch (e) {
   *       console.error(e.message);
   *     }
   *   });
   * }).on('error', (e) => {
   *   console.error(`Got error: ${e.message}`);
   * });
   *
   * // Create a local server to receive data from
   * const server = http.createServer((req, res) => {
   *   res.writeHead(200, { 'Content-Type': 'application/json' });
   *   res.end(JSON.stringify({
   *     data: 'Hello World!'
   *   }));
   * });
   *
   * server.listen(8000);
   * ```
   * @param options Accepts the same `options` as {@link request}, with the `method` always set to `GET`. Properties that are inherited from the prototype are ignored.
   */
  function get(options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void): ClientRequest;
  function get(url: string | URL, options: RequestOptions, callback?: (res: IncomingMessage) => void): ClientRequest;
  /**
   * Read-only property specifying the maximum allowed size of HTTP headers in bytes.
   * Defaults to 16KB. Configurable using the `--max-http-header-size` CLI option.
   */
  const maxHeaderSize: number;
}
declare module 'node:http' {
  export * from 'http';
}
// XXX: temporary types till theres a proper http(s) module
declare module 'https' {
  export * from 'http';
}
declare module 'node:https' {
  export * from 'http';
}

// ./punycode.d.ts

/**
 * **The version of the punycode module bundled in Node.js is being deprecated.**In a future major version of Node.js this module will be removed. Users
 * currently depending on the `punycode` module should switch to using the
 * userland-provided [Punycode.js](https://github.com/bestiejs/punycode.js) module instead. For punycode-based URL
 * encoding, see `url.domainToASCII` or, more generally, the `WHATWG URL API`.
 *
 * The `punycode` module is a bundled version of the [Punycode.js](https://github.com/bestiejs/punycode.js) module. It
 * can be accessed using:
 *
 * ```js
 * const punycode = require('punycode');
 * ```
 *
 * [Punycode](https://tools.ietf.org/html/rfc3492) is a character encoding scheme defined by RFC 3492 that is
 * primarily intended for use in Internationalized Domain Names. Because host
 * names in URLs are limited to ASCII characters only, Domain Names that contain
 * non-ASCII characters must be converted into ASCII using the Punycode scheme.
 * For instance, the Japanese character that translates into the English word,`'example'` is `'例'`. The Internationalized Domain Name, `'例.com'` (equivalent
 * to `'example.com'`) is represented by Punycode as the ASCII string`'xn--fsq.com'`.
 *
 * The `punycode` module provides a simple implementation of the Punycode standard.
 *
 * The `punycode` module is a third-party dependency used by Node.js and
 * made available to developers as a convenience. Fixes or other modifications to
 * the module must be directed to the [Punycode.js](https://github.com/bestiejs/punycode.js) project.
 * @deprecated
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/punycode.js)
 */
 declare module 'punycode' {
  /**
   * The `punycode.decode()` method converts a [Punycode](https://tools.ietf.org/html/rfc3492) string of ASCII-only
   * characters to the equivalent string of Unicode codepoints.
   *
   * ```js
   * punycode.decode('maana-pta'); // 'mañana'
   * punycode.decode('--dqo34k'); // '☃-⌘'
   * ```
   */
  function decode(string: string): string;
  /**
   * The `punycode.encode()` method converts a string of Unicode codepoints to a [Punycode](https://tools.ietf.org/html/rfc3492) string of ASCII-only characters.
   *
   * ```js
   * punycode.encode('mañana'); // 'maana-pta'
   * punycode.encode('☃-⌘'); // '--dqo34k'
   * ```
   */
  function encode(string: string): string;
  /**
   * The `punycode.toUnicode()` method converts a string representing a domain name
   * containing [Punycode](https://tools.ietf.org/html/rfc3492) encoded characters into Unicode. Only the [Punycode](https://tools.ietf.org/html/rfc3492) encoded parts of the domain name are be
   * converted.
   *
   * ```js
   * // decode domain names
   * punycode.toUnicode('xn--maana-pta.com'); // 'mañana.com'
   * punycode.toUnicode('xn----dqo34k.com');  // '☃-⌘.com'
   * punycode.toUnicode('example.com');       // 'example.com'
   * ```
   */
  function toUnicode(domain: string): string;
  /**
   * The `punycode.toASCII()` method converts a Unicode string representing an
   * Internationalized Domain Name to [Punycode](https://tools.ietf.org/html/rfc3492). Only the non-ASCII parts of the
   * domain name will be converted. Calling `punycode.toASCII()` on a string that
   * already only contains ASCII characters will have no effect.
   *
   * ```js
   * // encode domain names
   * punycode.toASCII('mañana.com');  // 'xn--maana-pta.com'
   * punycode.toASCII('☃-⌘.com');   // 'xn----dqo34k.com'
   * punycode.toASCII('example.com'); // 'example.com'
   * ```
   */
  function toASCII(domain: string): string;
  /**
   * @deprecated
   * The version of the punycode module bundled in Node.js is being deprecated.
   * In a future major version of Node.js this module will be removed.
   * Users currently depending on the punycode module should switch to using
   * the userland-provided Punycode.js module instead.
   */
  const ucs2: ucs2;
  interface ucs2 {
      /**
       * @deprecated
       * The version of the punycode module bundled in Node.js is being deprecated.
       * In a future major version of Node.js this module will be removed.
       * Users currently depending on the punycode module should switch to using
       * the userland-provided Punycode.js module instead.
       */
      decode(string: string): number[];
      /**
       * @deprecated
       * The version of the punycode module bundled in Node.js is being deprecated.
       * In a future major version of Node.js this module will be removed.
       * Users currently depending on the punycode module should switch to using
       * the userland-provided Punycode.js module instead.
       */
      encode(codePoints: ReadonlyArray<number>): string;
  }
  /**
   * @deprecated
   * The version of the punycode module bundled in Node.js is being deprecated.
   * In a future major version of Node.js this module will be removed.
   * Users currently depending on the punycode module should switch to using
   * the userland-provided Punycode.js module instead.
   */
  const version: string;
}
declare module 'node:punycode' {
  export * from 'punycode';
}

// ./zlib.d.ts

/**
 * The `zlib` module provides compression functionality implemented using Gzip,
 * Deflate/Inflate, and Brotli.
 *
 * To access it:
 *
 * ```js
 * const zlib = require('zlib');
 * ```
 *
 * Compression and decompression are built around the Node.js `Streams API`.
 *
 * Compressing or decompressing a stream (such as a file) can be accomplished by
 * piping the source stream through a `zlib` `Transform` stream into a destination
 * stream:
 *
 * ```js
 * const { createGzip } = require('zlib');
 * const { pipeline } = require('stream');
 * const {
 *   createReadStream,
 *   createWriteStream
 * } = require('fs');
 *
 * const gzip = createGzip();
 * const source = createReadStream('input.txt');
 * const destination = createWriteStream('input.txt.gz');
 *
 * pipeline(source, gzip, destination, (err) => {
 *   if (err) {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   }
 * });
 *
 * // Or, Promisified
 *
 * const { promisify } = require('util');
 * const pipe = promisify(pipeline);
 *
 * async function do_gzip(input, output) {
 *   const gzip = createGzip();
 *   const source = createReadStream(input);
 *   const destination = createWriteStream(output);
 *   await pipe(source, gzip, destination);
 * }
 *
 * do_gzip('input.txt', 'input.txt.gz')
 *   .catch((err) => {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   });
 * ```
 *
 * It is also possible to compress or decompress data in a single step:
 *
 * ```js
 * const { deflate, unzip } = require('zlib');
 *
 * const input = '.................................';
 * deflate(input, (err, buffer) => {
 *   if (err) {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   }
 *   console.log(buffer.toString('base64'));
 * });
 *
 * const buffer = Buffer.from('eJzT0yMAAGTvBe8=', 'base64');
 * unzip(buffer, (err, buffer) => {
 *   if (err) {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   }
 *   console.log(buffer.toString());
 * });
 *
 * // Or, Promisified
 *
 * const { promisify } = require('util');
 * const do_unzip = promisify(unzip);
 *
 * do_unzip(buffer)
 *   .then((buf) => console.log(buf.toString()))
 *   .catch((err) => {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   });
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/zlib.js)
 */
 declare module 'zlib' {
  import * as stream from 'node:stream';
  interface ZlibOptions {
      /**
       * @default constants.Z_NO_FLUSH
       */
      flush?: number | undefined;
      /**
       * @default constants.Z_FINISH
       */
      finishFlush?: number | undefined;
      /**
       * @default 16*1024
       */
      chunkSize?: number | undefined;
      windowBits?: number | undefined;
      level?: number | undefined; // compression only
      memLevel?: number | undefined; // compression only
      strategy?: number | undefined; // compression only
      dictionary?: ArrayBufferView | ArrayBuffer | undefined; // deflate/inflate only, empty dictionary by default
      info?: boolean | undefined;
      maxOutputLength?: number | undefined;
  }
  interface BrotliOptions {
      /**
       * @default constants.BROTLI_OPERATION_PROCESS
       */
      flush?: number | undefined;
      /**
       * @default constants.BROTLI_OPERATION_FINISH
       */
      finishFlush?: number | undefined;
      /**
       * @default 16*1024
       */
      chunkSize?: number | undefined;
      params?:
          | {
                /**
                 * Each key is a `constants.BROTLI_*` constant.
                 */
                [key: number]: boolean | number;
            }
          | undefined;
      maxOutputLength?: number | undefined;
  }
  interface Zlib {
      /** @deprecated Use bytesWritten instead. */
      readonly bytesRead: number;
      readonly bytesWritten: number;
      shell?: boolean | string | undefined;
      flush(kind?: number, callback?: () => void): void;
      flush(callback?: () => void): void;
  }
  interface ZlibParams {
      params(level: number, strategy: number, callback: () => void): void;
  }
  interface ZlibReset {
      reset(): void;
  }
  interface BrotliCompress extends stream.Transform, Zlib {}
  interface BrotliDecompress extends stream.Transform, Zlib {}
  interface Gzip extends stream.Transform, Zlib {}
  interface Gunzip extends stream.Transform, Zlib {}
  interface Deflate extends stream.Transform, Zlib, ZlibReset, ZlibParams {}
  interface Inflate extends stream.Transform, Zlib, ZlibReset {}
  interface DeflateRaw extends stream.Transform, Zlib, ZlibReset, ZlibParams {}
  interface InflateRaw extends stream.Transform, Zlib, ZlibReset {}
  interface Unzip extends stream.Transform, Zlib {}
  /**
   * Creates and returns a new `BrotliCompress` object.
   */
  function createBrotliCompress(options?: BrotliOptions): BrotliCompress;
  /**
   * Creates and returns a new `BrotliDecompress` object.
   */
  function createBrotliDecompress(options?: BrotliOptions): BrotliDecompress;
  /**
   * Creates and returns a new `Gzip` object.
   * See `example`.
   */
  function createGzip(options?: ZlibOptions): Gzip;
  /**
   * Creates and returns a new `Gunzip` object.
   */
  function createGunzip(options?: ZlibOptions): Gunzip;
  /**
   * Creates and returns a new `Deflate` object.
   */
  function createDeflate(options?: ZlibOptions): Deflate;
  /**
   * Creates and returns a new `Inflate` object.
   */
  function createInflate(options?: ZlibOptions): Inflate;
  /**
   * Creates and returns a new `DeflateRaw` object.
   *
   * An upgrade of zlib from 1.2.8 to 1.2.11 changed behavior when `windowBits`is set to 8 for raw deflate streams. zlib would automatically set `windowBits`to 9 if was initially set to 8\. Newer
   * versions of zlib will throw an exception,
   * so Node.js restored the original behavior of upgrading a value of 8 to 9,
   * since passing `windowBits = 9` to zlib actually results in a compressed stream
   * that effectively uses an 8-bit window only.
   */
  function createDeflateRaw(options?: ZlibOptions): DeflateRaw;
  /**
   * Creates and returns a new `InflateRaw` object.
   */
  function createInflateRaw(options?: ZlibOptions): InflateRaw;
  /**
   * Creates and returns a new `Unzip` object.
   */
  function createUnzip(options?: ZlibOptions): Unzip;
  type InputType = string | ArrayBuffer | ArrayBufferView;
  type CompressCallback = (error: Error | null, result: Buffer) => void;
  /**
   */
  function brotliCompress(buf: InputType, options: BrotliOptions, callback: CompressCallback): void;
  function brotliCompress(buf: InputType, callback: CompressCallback): void;
  namespace brotliCompress {
      function __promisify__(buffer: InputType, options?: BrotliOptions): Promise<Buffer>;
  }
  /**
   * Compress a chunk of data with `BrotliCompress`.
   */
  function brotliCompressSync(buf: InputType, options?: BrotliOptions): Buffer;
  /**
   */
  function brotliDecompress(buf: InputType, options: BrotliOptions, callback: CompressCallback): void;
  function brotliDecompress(buf: InputType, callback: CompressCallback): void;
  namespace brotliDecompress {
      function __promisify__(buffer: InputType, options?: BrotliOptions): Promise<Buffer>;
  }
  /**
   * Decompress a chunk of data with `BrotliDecompress`.
   */
  function brotliDecompressSync(buf: InputType, options?: BrotliOptions): Buffer;
  /**
   */
  function deflate(buf: InputType, callback: CompressCallback): void;
  function deflate(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace deflate {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Compress a chunk of data with `Deflate`.
   */
  function deflateSync(buf: InputType, options?: ZlibOptions): Buffer;
  /**
   */
  function deflateRaw(buf: InputType, callback: CompressCallback): void;
  function deflateRaw(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace deflateRaw {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Compress a chunk of data with `DeflateRaw`.
   */
  function deflateRawSync(buf: InputType, options?: ZlibOptions): Buffer;
  /**
   */
  function gzip(buf: InputType, callback: CompressCallback): void;
  function gzip(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace gzip {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Compress a chunk of data with `Gzip`.
   */
  function gzipSync(buf: InputType, options?: ZlibOptions): Buffer;
  /**
   */
  function gunzip(buf: InputType, callback: CompressCallback): void;
  function gunzip(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace gunzip {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Decompress a chunk of data with `Gunzip`.
   */
  function gunzipSync(buf: InputType, options?: ZlibOptions): Buffer;
  /**
   */
  function inflate(buf: InputType, callback: CompressCallback): void;
  function inflate(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace inflate {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Decompress a chunk of data with `Inflate`.
   */
  function inflateSync(buf: InputType, options?: ZlibOptions): Buffer;
  /**
   */
  function inflateRaw(buf: InputType, callback: CompressCallback): void;
  function inflateRaw(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace inflateRaw {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Decompress a chunk of data with `InflateRaw`.
   */
  function inflateRawSync(buf: InputType, options?: ZlibOptions): Buffer;
  /**
   */
  function unzip(buf: InputType, callback: CompressCallback): void;
  function unzip(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
  namespace unzip {
      function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
  }
  /**
   * Decompress a chunk of data with `Unzip`.
   */
  function unzipSync(buf: InputType, options?: ZlibOptions): Buffer;
  namespace constants {
      const BROTLI_DECODE: number;
      const BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES: number;
      const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP: number;
      const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES: number;
      const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1: number;
      const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2: number;
      const BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS: number;
      const BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET: number;
      const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1: number;
      const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2: number;
      const BROTLI_DECODER_ERROR_FORMAT_CL_SPACE: number;
      const BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT: number;
      const BROTLI_DECODER_ERROR_FORMAT_DICTIONARY: number;
      const BROTLI_DECODER_ERROR_FORMAT_DISTANCE: number;
      const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE: number;
      const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE: number;
      const BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE: number;
      const BROTLI_DECODER_ERROR_FORMAT_PADDING_1: number;
      const BROTLI_DECODER_ERROR_FORMAT_PADDING_2: number;
      const BROTLI_DECODER_ERROR_FORMAT_RESERVED: number;
      const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET: number;
      const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME: number;
      const BROTLI_DECODER_ERROR_FORMAT_TRANSFORM: number;
      const BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS: number;
      const BROTLI_DECODER_ERROR_INVALID_ARGUMENTS: number;
      const BROTLI_DECODER_ERROR_UNREACHABLE: number;
      const BROTLI_DECODER_NEEDS_MORE_INPUT: number;
      const BROTLI_DECODER_NEEDS_MORE_OUTPUT: number;
      const BROTLI_DECODER_NO_ERROR: number;
      const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: number;
      const BROTLI_DECODER_PARAM_LARGE_WINDOW: number;
      const BROTLI_DECODER_RESULT_ERROR: number;
      const BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: number;
      const BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: number;
      const BROTLI_DECODER_RESULT_SUCCESS: number;
      const BROTLI_DECODER_SUCCESS: number;
      const BROTLI_DEFAULT_MODE: number;
      const BROTLI_DEFAULT_QUALITY: number;
      const BROTLI_DEFAULT_WINDOW: number;
      const BROTLI_ENCODE: number;
      const BROTLI_LARGE_MAX_WINDOW_BITS: number;
      const BROTLI_MAX_INPUT_BLOCK_BITS: number;
      const BROTLI_MAX_QUALITY: number;
      const BROTLI_MAX_WINDOW_BITS: number;
      const BROTLI_MIN_INPUT_BLOCK_BITS: number;
      const BROTLI_MIN_QUALITY: number;
      const BROTLI_MIN_WINDOW_BITS: number;
      const BROTLI_MODE_FONT: number;
      const BROTLI_MODE_GENERIC: number;
      const BROTLI_MODE_TEXT: number;
      const BROTLI_OPERATION_EMIT_METADATA: number;
      const BROTLI_OPERATION_FINISH: number;
      const BROTLI_OPERATION_FLUSH: number;
      const BROTLI_OPERATION_PROCESS: number;
      const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: number;
      const BROTLI_PARAM_LARGE_WINDOW: number;
      const BROTLI_PARAM_LGBLOCK: number;
      const BROTLI_PARAM_LGWIN: number;
      const BROTLI_PARAM_MODE: number;
      const BROTLI_PARAM_NDIRECT: number;
      const BROTLI_PARAM_NPOSTFIX: number;
      const BROTLI_PARAM_QUALITY: number;
      const BROTLI_PARAM_SIZE_HINT: number;
      const DEFLATE: number;
      const DEFLATERAW: number;
      const GUNZIP: number;
      const GZIP: number;
      const INFLATE: number;
      const INFLATERAW: number;
      const UNZIP: number;
      // Allowed flush values.
      const Z_NO_FLUSH: number;
      const Z_PARTIAL_FLUSH: number;
      const Z_SYNC_FLUSH: number;
      const Z_FULL_FLUSH: number;
      const Z_FINISH: number;
      const Z_BLOCK: number;
      const Z_TREES: number;
      // Return codes for the compression/decompression functions.
      // Negative values are errors, positive values are used for special but normal events.
      const Z_OK: number;
      const Z_STREAM_END: number;
      const Z_NEED_DICT: number;
      const Z_ERRNO: number;
      const Z_STREAM_ERROR: number;
      const Z_DATA_ERROR: number;
      const Z_MEM_ERROR: number;
      const Z_BUF_ERROR: number;
      const Z_VERSION_ERROR: number;
      // Compression levels.
      const Z_NO_COMPRESSION: number;
      const Z_BEST_SPEED: number;
      const Z_BEST_COMPRESSION: number;
      const Z_DEFAULT_COMPRESSION: number;
      // Compression strategy.
      const Z_FILTERED: number;
      const Z_HUFFMAN_ONLY: number;
      const Z_RLE: number;
      const Z_FIXED: number;
      const Z_DEFAULT_STRATEGY: number;
      const Z_DEFAULT_WINDOWBITS: number;
      const Z_MIN_WINDOWBITS: number;
      const Z_MAX_WINDOWBITS: number;
      const Z_MIN_CHUNK: number;
      const Z_MAX_CHUNK: number;
      const Z_DEFAULT_CHUNK: number;
      const Z_MIN_MEMLEVEL: number;
      const Z_MAX_MEMLEVEL: number;
      const Z_DEFAULT_MEMLEVEL: number;
      const Z_MIN_LEVEL: number;
      const Z_MAX_LEVEL: number;
      const Z_DEFAULT_LEVEL: number;
      const ZLIB_VERNUM: number;
  }
  // Allowed flush values.
  /** @deprecated Use `constants.Z_NO_FLUSH` */
  const Z_NO_FLUSH: number;
  /** @deprecated Use `constants.Z_PARTIAL_FLUSH` */
  const Z_PARTIAL_FLUSH: number;
  /** @deprecated Use `constants.Z_SYNC_FLUSH` */
  const Z_SYNC_FLUSH: number;
  /** @deprecated Use `constants.Z_FULL_FLUSH` */
  const Z_FULL_FLUSH: number;
  /** @deprecated Use `constants.Z_FINISH` */
  const Z_FINISH: number;
  /** @deprecated Use `constants.Z_BLOCK` */
  const Z_BLOCK: number;
  /** @deprecated Use `constants.Z_TREES` */
  const Z_TREES: number;
  // Return codes for the compression/decompression functions.
  // Negative values are errors, positive values are used for special but normal events.
  /** @deprecated Use `constants.Z_OK` */
  const Z_OK: number;
  /** @deprecated Use `constants.Z_STREAM_END` */
  const Z_STREAM_END: number;
  /** @deprecated Use `constants.Z_NEED_DICT` */
  const Z_NEED_DICT: number;
  /** @deprecated Use `constants.Z_ERRNO` */
  const Z_ERRNO: number;
  /** @deprecated Use `constants.Z_STREAM_ERROR` */
  const Z_STREAM_ERROR: number;
  /** @deprecated Use `constants.Z_DATA_ERROR` */
  const Z_DATA_ERROR: number;
  /** @deprecated Use `constants.Z_MEM_ERROR` */
  const Z_MEM_ERROR: number;
  /** @deprecated Use `constants.Z_BUF_ERROR` */
  const Z_BUF_ERROR: number;
  /** @deprecated Use `constants.Z_VERSION_ERROR` */
  const Z_VERSION_ERROR: number;
  // Compression levels.
  /** @deprecated Use `constants.Z_NO_COMPRESSION` */
  const Z_NO_COMPRESSION: number;
  /** @deprecated Use `constants.Z_BEST_SPEED` */
  const Z_BEST_SPEED: number;
  /** @deprecated Use `constants.Z_BEST_COMPRESSION` */
  const Z_BEST_COMPRESSION: number;
  /** @deprecated Use `constants.Z_DEFAULT_COMPRESSION` */
  const Z_DEFAULT_COMPRESSION: number;
  // Compression strategy.
  /** @deprecated Use `constants.Z_FILTERED` */
  const Z_FILTERED: number;
  /** @deprecated Use `constants.Z_HUFFMAN_ONLY` */
  const Z_HUFFMAN_ONLY: number;
  /** @deprecated Use `constants.Z_RLE` */
  const Z_RLE: number;
  /** @deprecated Use `constants.Z_FIXED` */
  const Z_FIXED: number;
  /** @deprecated Use `constants.Z_DEFAULT_STRATEGY` */
  const Z_DEFAULT_STRATEGY: number;
  /** @deprecated */
  const Z_BINARY: number;
  /** @deprecated */
  const Z_TEXT: number;
  /** @deprecated */
  const Z_ASCII: number;
  /** @deprecated  */
  const Z_UNKNOWN: number;
  /** @deprecated */
  const Z_DEFLATED: number;
}
declare module 'node:zlib' {
  export * from 'zlib';
}

// ./supports-color.d.ts

declare module 'supports-color' {
  export interface Options {
    /**
    Whether `process.argv` should be sniffed for `--color` and `--no-color` flags.
    @default true
    */
    readonly sniffFlags?: boolean;
  }
  
  /**
  Levels:
  - `0` - All colors disabled.
  - `1` - Basic 16 colors support.
  - `2` - ANSI 256 colors support.
  - `3` - Truecolor 16 million colors support.
  */
  export type ColorSupportLevel = 0 | 1 | 2 | 3;
  
  /**
  Detect whether the terminal supports color.
  */
  export interface ColorSupport {
    /**
    The color level.
    */
    level: ColorSupportLevel;
  
    /**
    Whether basic 16 colors are supported.
    */
    hasBasic: boolean;
  
    /**
    Whether ANSI 256 colors are supported.
    */
    has256: boolean;
  
    /**
    Whether Truecolor 16 million colors are supported.
    */
    has16m: boolean;
  }
  
  export type ColorInfo = ColorSupport | false;
  
  export const supportsColor: {
    stdout: ColorInfo;
    stderr: ColorInfo;
  };

  export const stdout: ColorInfo;
  export const stderr: ColorInfo;
  
  export default supportsColor;
}
