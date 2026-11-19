// The OpenTelemetry span of an HTTP request that JavaScript sends: src/telemetry_jsc/http_client.rs

const begin = $bindgen("telemetry_internals.bind.ts", "httpClientBegin");
const end = $bindgen("telemetry_internals.bind.ts", "httpClientEnd");

const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;

interface RequestHeaders {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): unknown;
  removeHeader(name: string): unknown;
}

interface Response {
  statusCode?: number | null;
  httpVersion?: string | null;
  complete?: boolean;
}

/** A copy of `[name, value, ..]` or `[[name, value], ..]`. */
class HeaderList implements RequestHeaders {
  list: unknown[];
  #isOfPairs: boolean;

  constructor(list: unknown[]) {
    this.list = ArrayPrototypeSlice.$call(list);
    this.#isOfPairs = $isJSArray(list[0]);
  }

  #indexOf(name: string) {
    const list = this.list;
    const isOfPairs = this.#isOfPairs;
    for (let i = 0; i < list.length; i += isOfPairs ? 1 : 2) {
      const key = isOfPairs ? (list[i] as unknown[] | undefined)?.[0] : list[i];
      if (typeof key === "string" && StringPrototypeToLowerCase.$call(key) === name) return i;
    }
    return -1;
  }

  getHeader(name: string) {
    const at = this.#indexOf(name);
    if (at === -1) return undefined;
    return this.#isOfPairs ? (this.list[at] as unknown[])[1] : this.list[at + 1];
  }

  setHeader(name: string, value: string) {
    this.removeHeader(name);
    if (this.#isOfPairs) {
      $arrayPush(this.list, [name, value]);
    } else {
      $arrayPush(this.list, name);
      $arrayPush(this.list, value);
    }
  }

  removeHeader(name: string) {
    for (let at: number; (at = this.#indexOf(name)) !== -1;) {
      ArrayPrototypeSplice.$call(this.list, at, this.#isOfPairs ? 1 : 2);
    }
  }
}

class ClientSpan {
  #span: unknown;
  #method: string;
  #url: string;
  #status: number | null | undefined = undefined;
  #httpVersion: string | null | undefined = undefined;

  constructor(span: unknown, method: string, url: string) {
    this.#span = span;
    this.#method = method;
    this.#url = url;
  }

  /** Before the program gets to change it. */
  received(response: Response) {
    this.#status = response.statusCode;
    this.#httpVersion = response.httpVersion;
  }

  /** The first call counts. Whatever happens to the socket behind a complete response is no error of the request. */
  end(response: Response | null | undefined, error?: unknown) {
    end(
      this.#span as any,
      this.#method,
      this.#url,
      this.#status,
      this.#httpVersion,
      response?.complete ? undefined : (error ?? undefined),
    );
  }
}

/** Writes the context of the new span into `headers`. */
function startClientSpan(
  headers: RequestHeaders,
  method: string,
  protocol: string,
  host: string,
  givenPort: unknown,
  givenPath: unknown,
) {
  const port = `${givenPort}`;
  const path = `${givenPath}`;
  const started = begin(
    headers.getHeader("traceparent") as string,
    headers.getHeader("tracestate") as string,
    headers.getHeader("baggage") !== undefined,
  ) as unknown[] | undefined;
  if (started === undefined) return undefined;
  for (let i = 1; i < started.length; i += 2) {
    const value = started[i + 1] as string | null;
    if (value === null) headers.removeHeader(started[i] as string);
    else headers.setHeader(started[i] as string, value);
  }
  // Sent to a proxy, it is the whole URL.
  if (RegExpPrototypeExec.$call(/^[a-z][a-z0-9+.-]*:\/\//i, path) !== null)
    return new ClientSpan(started[0], method, path);
  let url = protocol + "//" + (host[0] !== "[" && StringPrototypeIncludes.$call(host, ":") ? `[${host}]` : host);
  if (port !== (protocol === "https:" ? "443" : "80")) url += ":" + port;
  // What CONNECT asks for is no path on this server.
  if (method !== "CONNECT") url += path;
  return new ClientSpan(started[0], method, url);
}

export type { ClientSpan };

export default { HeaderList, startClientSpan };
