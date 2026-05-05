// `bun:grpc` — native gRPC client.
//
// Thin wrapper over `fetch(url, { grpc: true })` which runs on the
// built-in HTTP/2 client. The request body is length-prefix-framed and
// the response trailers (`grpc-status`, `grpc-message`) are merged into
// `response.headers` by the native layer.

type TlsOptions = boolean | Bun.TLSOptions;

interface ClientOptions {
  tls?: TlsOptions;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

interface CallOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

interface UnaryResult {
  data: Uint8Array;
  status: number;
  message: string;
  headers: Headers;
  response: Response;
}

// gRPC status codes (PROTOCOL-HTTP2 spec).
const Status = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

// PROTOCOL-HTTP2 §"Appendix A": HTTP status → gRPC status when the
// response is not a gRPC response at all (no grpc-status header).
function statusFromHttp(code: number): number {
  switch (code) {
    case 400:
      return Status.INTERNAL;
    case 401:
      return Status.UNAUTHENTICATED;
    case 403:
      return Status.PERMISSION_DENIED;
    case 404:
      return Status.UNIMPLEMENTED;
    case 429:
    case 502:
    case 503:
    case 504:
      return Status.UNAVAILABLE;
    default:
      return Status.UNKNOWN;
  }
}

function percentDecode(s: string): string {
  // grpc-message is percent-encoded per spec.
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

class StatusError extends Error {
  code: number;
  details: string;
  headers: Headers | undefined;

  constructor(code: number, message: string, headers?: Headers) {
    super(message);
    this.name = "GrpcStatusError";
    this.code = code;
    this.details = message;
    this.headers = headers;
  }
}

class Client {
  #origin: string;
  #tls: TlsOptions | undefined;
  #headers: HeadersInit | undefined;
  #signal: AbortSignal | undefined;

  constructor(target: string | URL, options: ClientOptions = {}) {
    let origin: string;
    if (target instanceof URL) {
      origin = target.origin;
    } else if (typeof target === "string") {
      // Accept "host:port", "https://host:port", or a full URL. gRPC
      // requires HTTP/2 which in Bun's client is TLS-only, so default
      // to https:// when no scheme is present.
      if (target.startsWith("https://") || target.startsWith("http://")) {
        origin = new URL(target).origin;
      } else {
        origin = "https://" + target;
      }
    } else {
      throw $ERR_INVALID_ARG_TYPE("target", "string or URL", target);
    }
    this.#origin = origin;
    this.#tls = options.tls;
    this.#headers = options.headers;
    this.#signal = options.signal;
  }

  get origin(): string {
    return this.#origin;
  }

  /**
   * Make a unary gRPC request.
   *
   * `method` is the fully-qualified RPC path, e.g.
   * `/helloworld.Greeter/SayHello`. `body` is the serialised request
   * message (typically protobuf-encoded bytes); it is wrapped in a
   * gRPC Length-Prefixed Message by the native layer.
   *
   * Throws `StatusError` when `grpc-status` is non-zero.
   */
  async unary(method: string, body: BodyInit | null | undefined, options: CallOptions = {}): Promise<UnaryResult> {
    if (typeof method !== "string") {
      throw $ERR_INVALID_ARG_TYPE("method", "string", method);
    }
    if (method.charCodeAt(0) !== 0x2f /* '/' */) method = "/" + method;

    let headers: Headers | undefined;
    if (this.#headers || options.headers) {
      headers = new Headers(this.#headers);
      if (options.headers) {
        const extra = new Headers(options.headers);
        extra.forEach((value, key) => headers!.set(key, value));
      }
    }

    const init: Record<string, unknown> = {
      method: "POST",
      body: body ?? new Uint8Array(0),
      grpc: true,
      redirect: "manual",
      keepalive: true,
    };
    if (headers) init.headers = headers;
    if (this.#tls !== undefined) init.tls = this.#tls;
    if (options.signal) init.signal = options.signal;
    else if (this.#signal) init.signal = this.#signal;

    let response: Response;
    try {
      response = await fetch(this.#origin + method, init);
    } catch (err) {
      // Map transport failures to UNAVAILABLE / CANCELLED the way
      // grpc-js does, but keep the underlying message.
      const msg = err instanceof Error ? err.message : String(err);
      const code = err instanceof DOMException && err.name === "AbortError" ? Status.CANCELLED : Status.UNAVAILABLE;
      const se = new StatusError(code, msg);
      if (err instanceof Error) se.cause = err;
      throw se;
    }

    const resHeaders = response.headers;
    const rawStatus = resHeaders.get("grpc-status");
    let code: number;
    let message: string;
    if (rawStatus !== null) {
      code = Number.parseInt(rawStatus, 10);
      if (!Number.isFinite(code)) code = Status.UNKNOWN;
      message = percentDecode(resHeaders.get("grpc-message") ?? "");
    } else if (response.status !== 200) {
      code = statusFromHttp(response.status);
      message = `HTTP ${response.status}`;
    } else {
      // Server ended the stream without trailers — UNKNOWN per spec.
      code = Status.UNKNOWN;
      message = "missing grpc-status";
    }

    if (code !== Status.OK) {
      throw new StatusError(code, message, resHeaders);
    }

    const data = await response.bytes();
    return { data, status: code, message, headers: resHeaders, response };
  }

  /** Low-level access to the underlying fetch; no status handling. */
  request(method: string, body: BodyInit | null | undefined, options: CallOptions = {}): Promise<Response> {
    if (typeof method !== "string") {
      throw $ERR_INVALID_ARG_TYPE("method", "string", method);
    }
    if (method.charCodeAt(0) !== 0x2f) method = "/" + method;

    let headers: Headers | undefined;
    if (this.#headers || options.headers) {
      headers = new Headers(this.#headers);
      if (options.headers) {
        const extra = new Headers(options.headers);
        extra.forEach((value, key) => headers!.set(key, value));
      }
    }

    const init: Record<string, unknown> = {
      method: "POST",
      body: body ?? new Uint8Array(0),
      grpc: true,
      redirect: "manual",
      keepalive: true,
    };
    if (headers) init.headers = headers;
    if (this.#tls !== undefined) init.tls = this.#tls;
    if (options.signal) init.signal = options.signal;
    else if (this.#signal) init.signal = this.#signal;

    return fetch(this.#origin + method, init);
  }
}

export default {
  Client,
  Status,
  StatusError,
};
