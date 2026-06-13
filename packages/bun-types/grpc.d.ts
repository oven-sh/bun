/**
 * Native gRPC client. A thin wrapper over `fetch(url, { grpc: true })`
 * which runs on Bun's built-in HTTP/2 client.
 *
 * Only unary RPCs are supported. Requires TLS (the underlying HTTP/2
 * client is ALPN-negotiated).
 *
 * @experimental
 *
 * @example
 * ```ts
 * import { Client, Status } from "bun:grpc";
 *
 * const client = new Client("localhost:50051", { tls: { ca } });
 * const { data, status } = await client.unary(
 *   "/helloworld.Greeter/SayHello",
 *   protobufEncodedRequest,
 * );
 * ```
 */
declare module "bun:grpc" {
  /**
   * gRPC status codes.
   * @see https://grpc.io/docs/guides/status-codes/
   */
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

  type StatusCode = (typeof Status)[keyof typeof Status];

  interface ClientOptions {
    /**
     * TLS options passed through to `fetch`. Set to `false` only if you
     * have a proxy terminating TLS; plaintext h2c is not supported.
     */
    tls?: boolean | Bun.TLSOptions;
    /** Default metadata sent with every request. */
    headers?: Bun.HeadersInit;
    /** Abort every request made by this client. */
    signal?: AbortSignal;
  }

  interface CallOptions {
    /** Per-call metadata; merged over the client's default headers. */
    headers?: Bun.HeadersInit;
    signal?: AbortSignal;
  }

  interface UnaryResult {
    /** The response message payload (gRPC framing stripped). */
    data: Uint8Array;
    /** The `grpc-status` code. Always {@link Status.OK} on resolve. */
    status: number;
    /** The percent-decoded `grpc-message`. */
    message: string;
    /** Response headers with trailers merged in. */
    headers: Headers;
    /** The underlying `Response`. */
    response: Response;
  }

  /**
   * Error thrown by {@link Client.unary} when the RPC completes with a
   * non-OK `grpc-status`, or when the transport fails.
   */
  class StatusError extends Error {
    /** gRPC status code. */
    code: number;
    /** The percent-decoded `grpc-message`. Same as `.message`. */
    details: string;
    /** Response headers (with trailers merged), if the server replied. */
    headers: Headers | undefined;
    constructor(code: number, message: string, headers?: Headers);
  }

  /**
   * A gRPC channel bound to one origin.
   */
  class Client {
    /**
     * @param target `"host:port"`, `"https://host:port"`, or a `URL`.
     *   A bare `host:port` is treated as `https://host:port`.
     */
    constructor(target: string | URL, options?: ClientOptions);

    readonly origin: string;

    /**
     * Make a unary gRPC request.
     *
     * @param method Fully-qualified RPC path, e.g.
     *   `/helloworld.Greeter/SayHello`. A leading `/` is added if absent.
     * @param body The serialised request message (typically
     *   protobuf-encoded bytes). Wrapped in a gRPC Length-Prefixed
     *   Message by the native layer.
     * @throws {StatusError} when `grpc-status` is non-zero or the
     *   transport fails.
     */
    unary(method: string, body: Bun.BodyInit | null | undefined, options?: CallOptions): Promise<UnaryResult>;

    /**
     * Low-level access to the underlying `fetch`; no status handling.
     * The returned `Response` has trailers merged into `.headers`.
     */
    request(method: string, body: Bun.BodyInit | null | undefined, options?: CallOptions): Promise<Response>;
  }
}
