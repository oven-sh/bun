// The lock on the prototypes of Request, Response, Blob, Headers, URL and URLSearchParams does not reach subclasses or instances: overriding, own properties, another prototype for an instance and guarded polyfills behave as in plain Bun.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}
async function sayLater(label: string, work: () => Promise<unknown>) {
  let text: string;
  try {
    text = JSON.stringify(await work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

const urlOf = (request: Request) => request.url;
const methodOf = (request: Request) => request.method;
const headerOf = (request: Request, name: string) => request.headers.get(name);
const textOf = (body: Request | Response | Blob) => body.text();
const statusOf = (response: Response) => response.status;
const okOf = (response: Response) => response.ok;
const sizeOf = (blob: Blob) => blob.size;
const sliceOf = (blob: Blob) => blob.slice(1, 3);
const getFrom = (headers: Headers, name: string) => headers.get(name);
const hasIn = (headers: Headers, name: string) => headers.has(name);
const pathnameOf = (url: URL) => url.pathname;
const hrefOf = (url: URL) => url.href;
const jsonOf = (url: URL) => url.toJSON();
const queryOf = (url: URL, name: string) => url.searchParams.get(name);
const paramOf = (params: URLSearchParams, name: string) => params.get(name);
const countOf = (params: URLSearchParams) => params.size;
const untypedRead = (holder: any, name: string) => holder[name];
const untypedCall = (holder: any, name: string, ...rest: unknown[]) => holder[name](...rest);

const internal = Symbol("internal request state");
class FrameworkURL {
  constructor(
    readonly inner: URL,
    readonly basePath: string,
  ) {}
  toString() {
    return this.inner.origin + this.basePath + this.inner.pathname + this.inner.search;
  }
}
class FrameworkRequest extends Request {
  [internal]: { cookies: Map<string, string>; nextUrl: FrameworkURL; url: string };
  constructor(input: string | Request, init: RequestInit & { basePath?: string } = {}) {
    const url = typeof input === "string" ? input : input.url;
    super(input, init);
    const nextUrl = new FrameworkURL(new URL(url), init.basePath ?? "");
    this[internal] = { cookies: new Map((this.headers.get("cookie") ?? "").split("; ").filter(Boolean).map(pair => pair.split("=") as [string, string])), nextUrl, url: nextUrl.toString() };
  }
  get cookies() {
    return this[internal].cookies;
  }
  get nextUrl() {
    return this[internal].nextUrl;
  }
  override get url() {
    return this[internal].url;
  }
  override clone(): FrameworkRequest {
    return new FrameworkRequest(super.clone(), { basePath: this[internal].nextUrl.basePath });
  }
}
const framework = () => new FrameworkRequest("http://example.com/a?b=c", { method: "POST", body: "payload", headers: { cookie: "x=1; y=2" }, basePath: "/base" });
say("a framework's request: url through the base type", () => urlOf(framework()));
say("a framework's request: url untyped", () => untypedRead(framework(), "url"));
say("a framework's request: the base getter on it", () => Object.getOwnPropertyDescriptor(Request.prototype, "url")!.get!.call(framework()));
say("a framework's request: method and header through the base type", () => [methodOf(framework()), headerOf(framework(), "cookie")]);
say("a framework's request: its own getters", () => [[...framework().cookies], framework().nextUrl.toString()]);
say("a framework's request: instanceof", () => [framework() instanceof Request, framework() instanceof FrameworkRequest, Object.getPrototypeOf(FrameworkRequest.prototype) === Request.prototype]);
say("a framework's request: clone", () => [framework().clone() instanceof FrameworkRequest, urlOf(framework().clone())]);
say("a framework's request: handed to new Request", () => urlOf(new Request(framework())));
say("a framework's request: read many times beside plain requests", () => {
  const requests: Request[] = [framework(), new Request("http://plain.example/"), framework(), new Request("http://plain.example/2")];
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(urlOf(requests[i & 3]));
  return [...seen];
});

class CountingRequest extends Request {
  reads = 0;
  readonly tag: string = "counting";
  override get method() {
    this.reads++;
    return "OVERRIDDEN " + super.method;
  }
  override text() {
    return super.text().then(text => "overridden " + text);
  }
}
class CountingResponse extends Response {
  reads = 0;
  readonly tag: string = "counting";
  override get status() {
    this.reads++;
    return super.status + 1000;
  }
  override text() {
    return super.text().then(text => "overridden " + text);
  }
}
class CountingBlob extends Blob {
  reads = 0;
  readonly tag: string = "counting";
  override get size() {
    this.reads++;
    return super.size + 1000;
  }
  override slice(start?: number, end?: number, type?: string) {
    return new Blob(["overridden ", super.slice(start, end, type)]);
  }
}
class CountingHeaders extends Headers {
  reads = 0;
  readonly tag: string = "counting";
  override get(name: string) {
    this.reads++;
    return "overridden " + super.get(name);
  }
  get first() {
    return [...this.keys()][0];
  }
}
class CountingURL extends URL {
  reads = 0;
  readonly tag: string = "counting";
  override get pathname() {
    this.reads++;
    return "/overridden" + super.pathname;
  }
  override set pathname(value: string) {
    super.pathname = value;
  }
  override toJSON() {
    return "overridden " + super.toJSON();
  }
}
class CountingParams extends URLSearchParams {
  reads = 0;
  readonly tag: string = "counting";
  override get size() {
    this.reads++;
    return super.size + 1000;
  }
  override get(name: string) {
    return "overridden " + super.get(name);
  }
}

say("a subclass of Request", () => {
  const request = new CountingRequest("http://example.com/", { method: "PUT" });
  return [methodOf(request), untypedRead(request, "method"), request.reads, request.tag, urlOf(request), request instanceof Request];
});
await sayLater("a subclass of Request: an overridden method", () => textOf(new CountingRequest("http://example.com/", { method: "POST", body: "body" })));
say("a subclass of Response", () => {
  const response = new CountingResponse("body", { status: 201 });
  return [statusOf(response), untypedRead(response, "status"), response.reads, response.tag, okOf(response), response instanceof Response];
});
await sayLater("a subclass of Response: an overridden method", () => textOf(new CountingResponse("body")));
say("a subclass of Blob", () => {
  const blob = new CountingBlob(["abcdef"]);
  return [sizeOf(blob), untypedRead(blob, "size"), blob.reads, blob.tag, blob instanceof Blob];
});
await sayLater("a subclass of Blob: an overridden method", () => sliceOf(new CountingBlob(["abcdef"])).text());
say("a subclass of Headers", () => {
  const headers = new CountingHeaders({ a: "1", b: "2" });
  return [getFrom(headers, "a"), untypedCall(headers, "get", "b"), headers.reads, headers.tag, headers.first, hasIn(headers, "b"), headers instanceof Headers];
});
say("a subclass of URL", () => {
  const url = new CountingURL("http://example.com/a/b?c=d");
  url.pathname = "/e";
  return [pathnameOf(url), untypedRead(url, "pathname"), url.reads, url.tag, jsonOf(url), hrefOf(url), queryOf(url, "c"), JSON.stringify({ url }), url instanceof URL];
});
say("a subclass of URLSearchParams", () => {
  const params = new CountingParams("a=1&b=2");
  return [countOf(params), untypedRead(params, "size"), params.reads, params.tag, paramOf(params, "a"), untypedCall(params, "get", "b"), String(params), params instanceof URLSearchParams];
});
say("the prototype of a subclass can be changed", () => {
  class Patched extends Response {}
  (Patched.prototype as any).extra = () => "added";
  Object.defineProperty(Patched.prototype, "status", { get: () => 299, configurable: true });
  (Patched.prototype as any).json = () => "replaced";
  const response = new Patched("x");
  return [(response as any).extra(), statusOf(response), untypedCall(response, "json"), delete (Patched.prototype as any).json, typeof response.json];
});
say("a subclass can get another parent", () => {
  class Base extends Headers {}
  class Other extends Headers {
    override get(name: string) {
      return "other " + super.get(name);
    }
  }
  Object.setPrototypeOf(Base.prototype, Other.prototype);
  return getFrom(new Base({ a: "1" }), "a");
});
say("a class made with Object.create and Reflect.construct", () => {
  function Legacy(this: unknown, url: string) {
    return Reflect.construct(URL, [url], Legacy);
  }
  Legacy.prototype = Object.create(URL.prototype, { pathname: { get: () => "/legacy" }, constructor: { value: Legacy } });
  const url = new (Legacy as unknown as new (url: string) => URL)("http://example.com/a");
  return [pathnameOf(url), hrefOf(url), url instanceof URL];
});

say("own properties on a Request", () => {
  const request = new Request("http://example.com/");
  Object.defineProperty(request, "url", { value: "own url" });
  Object.defineProperty(request, "headers", { get: () => new Headers({ own: "yes" }) });
  (request as any).text = () => "own text";
  (request as any).extra = 1;
  return [urlOf(request), headerOf(request, "own"), untypedCall(request, "text"), (request as any).extra, Object.keys(request)];
});
say("own properties on a Response", () => {
  const response = new Response("x");
  Object.defineProperty(response, "url", { value: "http://own.example/" });
  Object.defineProperty(response, "type", { value: "cors" });
  Object.defineProperty(response, "status", { value: 599 });
  (response as any).json = () => "own json";
  return [response.url, response.type, statusOf(response), untypedCall(response, "json")];
});
say("own properties on a Blob, Headers, URL and URLSearchParams", () => {
  const blob = new Blob(["abc"]);
  const headers = new Headers({ a: "1" });
  const url = new URL("http://example.com/a");
  const params = new URLSearchParams("a=1");
  Object.defineProperty(blob, "size", { value: -1 });
  (headers as any).get = () => "own get";
  Object.defineProperty(url, "pathname", { value: "/own" });
  (url as any).toJSON = () => "own json";
  (params as any).get = () => "own get";
  Object.defineProperty(params, "size", { value: -1 });
  return [sizeOf(blob), getFrom(headers, "a"), pathnameOf(url), jsonOf(url), JSON.stringify(url), paramOf(params, "a"), countOf(params)];
});
say("an own property is deleted again", () => {
  const url = new URL("http://example.com/a");
  Object.defineProperty(url, "pathname", { value: "/own", configurable: true });
  const shadowed = pathnameOf(url);
  delete (url as any).pathname;
  return [shadowed, pathnameOf(url)];
});

say("Object.setPrototypeOf(instance, another object)", () => {
  const request = Object.setPrototypeOf(new Request("http://example.com/"), { url: "another prototype", method: "OTHER" }) as Request;
  const response = Object.setPrototypeOf(new Response("x", { status: 201 }), { status: -1 }) as Response;
  const blob = Object.setPrototypeOf(new Blob(["abc"]), { size: -1 }) as Blob;
  const headers = Object.setPrototypeOf(new Headers({ a: "1" }), { get: () => "another get" }) as Headers;
  const url = Object.setPrototypeOf(new URL("http://example.com/a"), { pathname: "/another" }) as URL;
  const params = Object.setPrototypeOf(new URLSearchParams("a=1"), { get: () => "another get", size: -1 }) as URLSearchParams;
  return [urlOf(request), methodOf(request), statusOf(response), sizeOf(blob), getFrom(headers, "a"), pathnameOf(url), paramOf(params, "a"), countOf(params)];
});
say("Object.setPrototypeOf(instance, an object in between)", () => {
  const between = Object.create(URL.prototype, { pathname: { get: () => "/between" } });
  const url = Object.setPrototypeOf(new URL("http://example.com/a?b=c"), between) as URL;
  return [pathnameOf(url), hrefOf(url), queryOf(url, "b"), url instanceof URL];
});
say("Object.setPrototypeOf(instance, null) and back", () => {
  const headers = new Headers({ a: "1" });
  Object.setPrototypeOf(headers, null);
  const without = typeof (headers as any).get;
  Object.setPrototypeOf(headers, Headers.prototype);
  return [without, getFrom(headers, "a")];
});
say("instance.__proto__ = another object", () => {
  const params = new URLSearchParams("a=1");
  (params as any).__proto__ = { get: () => "another get" };
  return paramOf(params, "a");
});

say("guarded polyfills assign nothing", () => {
  (Headers.prototype as any).getSetCookie ??= function () {
    return ["polyfill"];
  };
  (URLSearchParams.prototype as any).has ||= () => "polyfill";
  if (!("formData" in Response.prototype)) (Response.prototype as any).formData = () => "polyfill";
  if (typeof Blob.prototype.arrayBuffer !== "function") (Blob.prototype as any).arrayBuffer = () => "polyfill";
  if (!Request.prototype.hasOwnProperty("signal")) Object.defineProperty(Request.prototype, "signal", { get: () => "polyfill" });
  if (!Object.getOwnPropertyDescriptor(URL.prototype, "searchParams")) Object.defineProperty(URL.prototype, "searchParams", { get: () => "polyfill" });
  (URL as any).canParse ??= () => "polyfill";
  const headers = new Headers();
  headers.append("set-cookie", "a=1");
  return [headers.getSetCookie(), new URLSearchParams("a=1").has("a"), typeof new Response("").formData, URL.canParse("http://example.com/")];
});
say("a polyfill inside try and catch falls back", () => {
  let fellBack = false;
  try {
    if (!(Headers.prototype as any).missingFeature) throw new TypeError("not supported");
  } catch {
    fellBack = true;
  }
  return fellBack;
});

say("methods borrowed from the prototypes", () => [
  Headers.prototype.get.call(new Headers({ a: "1" }), "a"),
  URLSearchParams.prototype.get.call(new URLSearchParams("a=1"), "a"),
  URL.prototype.toJSON.call(new URL("http://example.com/")),
  Reflect.get(URL.prototype, "pathname", new URL("http://example.com/a")),
  Reflect.ownKeys(Headers.prototype).filter(key => typeof key === "symbol").map(String),
]);
say("what the descriptors of instances and subclasses say", () => {
  class Sub extends Blob {}
  return [Object.isExtensible(new Blob([])), Object.isExtensible(Sub.prototype), Object.isExtensible(Sub), Object.isFrozen(new URL("http://example.com/"))];
});

console.log(lines.join("\n"));
