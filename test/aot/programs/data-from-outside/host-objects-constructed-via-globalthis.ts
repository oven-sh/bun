// A host object constructed with `new globalThis.X()` works with the program's own structural types exactly like one constructed with `new X()`: it is read by name and never rejected.
type SocketLike = { readonly readyState: number; close(): void; send(data: string): void };
class FakeSocket { readyState = 7; close() {} send(data: string) {} }
class Transport {
  constructor(private socket: SocketLike) {}
  state() { return typeof this.socket.readyState; }
  end() { this.socket.close(); }
}

interface ParamsLike { get(name: string): string | null }
interface UrlLike { href: string; searchParams: ParamsLike }
class FakeParams implements ParamsLike { get(name: string) { return "fake-" + name; } }
class FakeUrl implements UrlLike { href = "fake:"; searchParams: ParamsLike = new FakeParams(); }
function showUrl(url: UrlLike) { return url.href + " " + url.searchParams.get("a"); }

interface HeadersLike { get(name: string): string | null; has(name: string): boolean }
interface ResponseLike { status: number; ok: boolean; headers: HeadersLike }
class FakeHeaders implements HeadersLike { get(name: string) { return name; } has(name: string) { return false; } }
class FakeResponse implements ResponseLike { status = 1; ok = false; headers: HeadersLike = new FakeHeaders(); }
function showResponse(response: ResponseLike) { return response.status + " " + response.ok + " " + response.headers.get("x-a") + " " + response.headers.has("x-b"); }

interface SignalLike { aborted: boolean }
interface ControllerLike { signal: SignalLike; abort(): void }
class FakeSignal implements SignalLike { aborted = false; }
class FakeController implements ControllerLike { signal: SignalLike = new FakeSignal(); abort() { this.signal.aborted = true; } }
function abortAndShow(controller: ControllerLike) { const before = controller.signal.aborted; controller.abort(); return before + " " + controller.signal.aborted; }

const socket: SocketLike = new globalThis.WebSocket("ws://127.0.0.1:9");
const transports = [new Transport(socket), new Transport(new FakeSocket())];
console.log(transports.map(transport => transport.state()).join());
for (const transport of transports) transport.end();

const url: UrlLike = new globalThis.URL("http://host/path?a=1");
console.log(showUrl(url), "|", showUrl(new FakeUrl()), "|", showUrl(new globalThis.URL("http://host/?a=2")));

const response: ResponseLike = new globalThis.Response("body", { status: 201, headers: { "x-a": "b" } });
console.log(showResponse(response), "|", showResponse(new FakeResponse()));
const responses: ResponseLike[] = [new FakeResponse(), new globalThis.Response(null, { status: 204 })];
console.log(responses.map(showResponse).join(" | "));

console.log(abortAndShow(new globalThis.AbortController()), "|", abortAndShow(new FakeController()));

class Holder { held: UrlLike | null = null; }
const holder = new Holder();
holder.held = new globalThis.URL("http://held/?a=3");
console.log(showUrl(holder.held));
function made(): ResponseLike { return new globalThis.Response("", { status: 202 }); }
console.log(showResponse(made()));
