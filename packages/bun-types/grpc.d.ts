/**
 * What the clients and servers of an imported `.proto` file have in common.
 *
 * @example
 * ```ts
 * import * as helloworld from "./helloworld.proto";
 *
 * const server = Bun.serve({
 *   http2: true,
 *   routes: helloworld.Greeter.routes({
 *     sayHello: request => ({ message: `Hello ${request.name}` }),
 *   }),
 * });
 *
 * const client = new helloworld.Greeter.Client(server.url);
 * await client.sayHello({ name: "Bun" }); // { message: "Hello Bun" }
 * ```
 *
 * @experimental
 * @module bun:grpc
 */
declare module "bun:grpc" {
  /** https://grpc.io/docs/guides/status-codes/ */
  const Status: {
    readonly OK: 0;
    readonly CANCELLED: 1;
    readonly UNKNOWN: 2;
    readonly INVALID_ARGUMENT: 3;
    readonly DEADLINE_EXCEEDED: 4;
    readonly NOT_FOUND: 5;
    readonly ALREADY_EXISTS: 6;
    readonly PERMISSION_DENIED: 7;
    readonly RESOURCE_EXHAUSTED: 8;
    readonly FAILED_PRECONDITION: 9;
    readonly ABORTED: 10;
    readonly OUT_OF_RANGE: 11;
    readonly UNIMPLEMENTED: 12;
    readonly INTERNAL: 13;
    readonly UNAVAILABLE: 14;
    readonly DATA_LOSS: 15;
    readonly UNAUTHENTICATED: 16;
  };
  type Status = (typeof Status)[keyof typeof Status];

  /**
   * What a call rejects with when it fails. A handler throws one to choose the
   * status that the client receives.
   *
   * @example
   * ```ts
   * throw new GrpcError(Status.NOT_FOUND, `No user has the id ${id}`);
   * ```
   */
  class GrpcError extends Error {
    constructor(
      code: Exclude<Status, 0>,
      message?: string,
      options?: { trailers?: Bun.HeadersInit | undefined; cause?: unknown },
    );
    readonly name: "GrpcError";
    readonly code: Exclude<Status, 0>;
    /**
     * The metadata that goes with the status. A handler that lets the error of
     * a call propagate passes on its code and message, not its trailers.
     */
    readonly trailers: Headers;
  }

  type Messages<T> = AsyncIterable<T> | Iterable<T>;

  interface CallOptions {
    /** Metadata for this call, on top of {@link ClientOptions.headers}. */
    headers?: Bun.HeadersInit | undefined;
    /** Aborting it fails the call with `Status.CANCELLED`. */
    signal?: AbortSignal | undefined;
    /**
     * Milliseconds after which the call fails with `Status.DEADLINE_EXCEEDED`.
     * The server receives the same deadline.
     */
    timeout?: number | undefined;
    /** Called with the metadata that comes before the first message, if there is any. */
    onHeaders?(headers: Headers): void;
    /** Called with the metadata that comes with the status. */
    onTrailers?(trailers: Headers): void;
  }

  interface ClientOptions {
    /** Metadata for every call. */
    headers?: Bun.HeadersInit | undefined;
    /** The default for {@link CallOptions.timeout}. Without one, a call has no deadline. */
    timeout?: number | undefined;
    /** As for `fetch()`. */
    tls?: BunFetchRequestInit["tls"] | undefined;
    /** The path of a Unix socket to connect to. Requires an `http://` URL. */
    unix?: string | undefined;
    /**
     * Sends the request of every call. It must return the `Response` that
     * Bun's `fetch()` returned, because that object carries the trailers.
     *
     * @example
     * ```ts
     * using session = new Bun.FetchSession();
     * const client = new Greeter.Client(url, { fetch: session.fetch });
     * ```
     */
    fetch?(url: string, init: BunFetchRequestInit): Promise<Response>;
    /**
     * A longer response message fails the call with `Status.RESOURCE_EXHAUSTED`.
     * @default 4 * 1024 * 1024
     */
    maxReceiveMessageLength?: number | undefined;
  }

  interface CallContext {
    readonly server: Bun.Server<unknown>;
    /** For example `"/helloworld.Greeter/SayHello"` */
    readonly path: string;
    /** The host and port that the client asked for, such as `"localhost:3000"`. */
    readonly host: string;
    /** The metadata of the call: the request headers without the fields of HTTP and gRPC themselves. */
    readonly headers: Headers;
    /**
     * Aborts with a {@link GrpcError} when the call ends before its handler
     * does: the client cancels it, the deadline passes, or a request is invalid.
     */
    readonly signal: AbortSignal;
    /** Metadata to send before the first message. Changes after that have no effect. */
    readonly responseHeaders: Headers;
    /** Metadata to send with the status. */
    readonly responseTrailers: Headers;
    /** The address of the client. `null` on a Unix socket and once the call has ended. */
    requestIP(): Bun.SocketAddress | null;
    /**
     * Replaces the `idleTimeout` of the server for this call.
     * @param seconds An integer from 0 to 255. `0` disables the timeout.
     */
    timeout(seconds: number): void;
  }

  interface RoutesOptions {
    /**
     * A longer request message fails the call with `Status.RESOURCE_EXHAUSTED`,
     * and so does one that is longer than the `maxRequestBodySize` of the server.
     * @default 4 * 1024 * 1024
     */
    maxReceiveMessageLength?: number | undefined;
    /**
     * Called when a handler throws something other than a {@link GrpcError}.
     * The client receives the `GrpcError` it returns, or else `Status.UNKNOWN`
     * and nothing of the error. By default the error goes to `console.error`.
     */
    onError?(error: unknown, context: CallContext): GrpcError | void;
  }

  /** The value of one path in the `routes` of `Bun.serve()`. */
  interface Route {
    readonly [Symbol.toStringTag]: "GrpcRoute";
  }

  /** Messages to send, and what turns one into bytes that start with the 5-byte prefix of gRPC. */
  interface Outgoing<T = any> {
    messages: Messages<T>;
    frame(message: T): Uint8Array;
  }

  /**
   * What a generated `Client` calls. The bytes it takes start with the 5-byte
   * prefix of gRPC. The bytes it returns do not.
   */
  class Channel {
    /** @param url An `https://` URL, or an `http://` URL for HTTP/2 without TLS */
    constructor(url: string | URL, options?: ClientOptions);
    call(path: string, request: Uint8Array | Outgoing, options?: CallOptions): Promise<Uint8Array>;
    stream(path: string, request: Uint8Array | Outgoing, options?: CallOptions): AsyncGenerator<Uint8Array, void, void>;
  }

  /**
   * What a generated `routes()` calls. The bytes that `frame` returns start
   * with the 5-byte prefix of gRPC. The bytes that `handler` takes do not.
   * Without a `handler`, calls fail with `Status.UNIMPLEMENTED`.
   */
  function route<RequestStream extends boolean, ResponseStream extends boolean, T>(
    requestStream: RequestStream,
    responseStream: ResponseStream,
    handler:
      | ((
          request: RequestStream extends true ? AsyncGenerator<Uint8Array, void, void> : Uint8Array,
          context: CallContext,
        ) => NoInfer<ResponseStream extends true ? Messages<T> | Promise<Messages<T>> : T | Promise<T>>)
      | undefined,
    frame: (message: T) => Uint8Array,
    options?: RoutesOptions,
  ): Route;
}
