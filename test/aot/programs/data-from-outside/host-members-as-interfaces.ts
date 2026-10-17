// A member of a host object is often a host object too. When the outer object is used through one of the program's interfaces, each member is used through the interface's own member type: a property, a method's return value, a promise's value, an array's elements, a callback's parameter. Each case has its own interfaces, and for each a program class with one extra member, so no host object matches those classes. The output must match plain Bun.
import { statSync } from "node:fs";

// a property
interface ParamsLike { get(name: string): string | null }
interface UrlLike { href: string; searchParams: ParamsLike }
class FakeParams implements ParamsLike { fakeOnly = 0; get(name: string): string | null { return "fake-" + name; } }
class FakeUrl implements UrlLike { fakeOnly = 0; href = "fake:"; searchParams: ParamsLike = new FakeParams(); }
function showUrl(url: UrlLike) { return url.href + " " + url.searchParams.get("a"); }
const url: UrlLike = new URL("http://h/p?a=1");
console.log(showUrl(url), showUrl(new FakeUrl()));

// a method's return value
interface BytesLike { length: number; byteLength: number }
interface EncoderLike { encoding: string; encode(text?: string): BytesLike }
class FakeBytes implements BytesLike { fakeOnly = 0; length = -1; byteLength = -2; }
class FakeEncoder implements EncoderLike { fakeOnly = 0; encoding = "fake"; encode(): BytesLike { return new FakeBytes(); } }
function showEncoder(encoder: EncoderLike) { const bytes = encoder.encode("abc"); return encoder.encoding + " " + bytes.length + " " + bytes.byteLength; }
console.log(showEncoder(new TextEncoder()), showEncoder(new FakeEncoder()));

// two properties
interface ReadableLike { locked: boolean; cancel(reason?: unknown): Promise<void> }
interface WritableLike { locked: boolean; abort(reason?: unknown): Promise<void> }
interface TransformLike { readable: ReadableLike; writable: WritableLike }
class FakeReadable implements ReadableLike { fakeOnly = 0; locked = true; async cancel() {} }
class FakeWritable implements WritableLike { fakeOnly = 0; locked = true; async abort() {} }
class FakeTransform implements TransformLike { fakeOnly = 0; readable: ReadableLike = new FakeReadable(); writable: WritableLike = new FakeWritable(); }
function showTransform(transform: TransformLike) { return transform.readable.locked + " " + transform.writable.locked; }
function makeTransform(): TransformLike { return new TransformStream(); }
console.log(showTransform(makeTransform()), showTransform(new FakeTransform()));

// a member that is a built-in class
interface DateLike { getTime(): number }
interface StatsLike { size: number; mtime: DateLike; isDirectory(): boolean }
class FakeDate implements DateLike { fakeOnly = 0; getTime() { return -1; } }
class FakeStats implements StatsLike { fakeOnly = 0; size = -1; mtime: DateLike = new FakeDate(); isDirectory() { return false; } }
function showStats(stats: StatsLike) { return stats.isDirectory() + " " + (stats.mtime.getTime() > 0); }
class StatsHolder { constructor(public stats: StatsLike) {} }
console.log(showStats(new StatsHolder(statSync(".")).stats), showStats(new FakeStats()));

// two levels down
interface ReaderLike { releaseLock(): void }
interface BodyLike { locked: boolean; getReader(): ReaderLike }
interface ResponseLike { status: number; body: BodyLike | null }
class FakeReader implements ReaderLike { fakeOnly = 0; releaseLock() {} }
class FakeBody implements BodyLike { fakeOnly = 0; locked = false; getReader(): ReaderLike { return new FakeReader(); } }
class FakeResponse implements ResponseLike { fakeOnly = 0; status = 1; body: BodyLike | null = new FakeBody(); }
function showResponse(response: ResponseLike) {
  const body = response.body;
  if (!body) return "none";
  const reader = body.getReader();
  const locked = body.locked;
  reader.releaseLock();
  return response.status + " " + locked + " " + body.locked;
}
const responses: ResponseLike[] = [new Response("abc", { status: 201 }), new FakeResponse()];
console.log(responses.map(showResponse).join());

// a promise's value
interface BlobLike { size: number; type: string }
interface BlobSourceLike { blob(): Promise<BlobLike> }
class FakeBlob implements BlobLike { fakeOnly = 0; size = -1; type = "fake"; }
class FakeBlobSource implements BlobSourceLike { fakeOnly = 0; async blob(): Promise<BlobLike> { return new FakeBlob(); } }
async function showBlob(source: BlobSourceLike) { const blob = await source.blob(); return blob.size + " " + typeof blob.type; }
console.log(await showBlob(new Response("abcd")), await showBlob(new FakeBlobSource()));

// an array's elements
interface FileLike { name: string; size: number }
interface FormLike { getAll(name: string): (string | FileLike)[] }
class FakeFile implements FileLike { fakeOnly = 0; name = "fake"; size = -1; }
class FakeForm implements FormLike { fakeOnly = 0; getAll(name: string): (string | FileLike)[] { return [name, new FakeFile()]; } }
function showForm(form: FormLike) { return form.getAll("f").map(entry => (typeof entry === "string" ? entry : entry.name + entry.size)).join(); }
const formData = new FormData();
formData.append("f", "text");
formData.append("f", new File(["abc"], "a.txt"));
console.log(showForm(formData), showForm(new FakeForm()));

// a callback's parameter
interface EventLike { type: string }
interface TargetLike { addEventListener(type: string, listener: (event: EventLike) => void): void; dispatchEvent(event: Event): boolean }
class FakeEvent implements EventLike { fakeOnly = 0; type = "fake"; }
class FakeTarget implements TargetLike {
  fakeOnly = 0;
  listener: ((event: EventLike) => void) | null = null;
  addEventListener(type: string, listener: (event: EventLike) => void) { this.listener = listener; }
  dispatchEvent(event: Event) { this.listener?.(new FakeEvent()); return true; }
}
function listen(target: TargetLike) {
  let seen = "none";
  target.addEventListener("ping", event => { seen = event.type; });
  target.dispatchEvent(new Event("ping"));
  return seen;
}
console.log(listen(new EventTarget()), listen(new FakeTarget()));

// a method that returns the same interface
interface SliceLike { size: number; slice(start?: number, end?: number): SliceLike }
class FakeSlice implements SliceLike { fakeOnly = 0; size = -1; slice(): SliceLike { return this; } }
function showSlice(whole: SliceLike) { return whole.slice(1, 5).slice(1).size; }
console.log(showSlice(new Blob(["abcdef"])), showSlice(new FakeSlice()));

// the outer object passes through a local typed as its own class
interface HeaderBagLike { get(name: string): string | null; has(name: string): boolean }
interface RequestLike { method: string; headers: HeaderBagLike }
class FakeHeaderBag implements HeaderBagLike { fakeOnly = 0; get(name: string): string | null { return "fake-" + name; } has(name: string) { return false; } }
class FakeRequest implements RequestLike { fakeOnly = 0; method = "FAKE"; headers: HeaderBagLike = new FakeHeaderBag(); }
function showRequest(request: RequestLike) { return request.method + " " + request.headers.get("x-a") + " " + request.headers.has("x-b"); }
const rawRequest: Request = new Request("http://h/", { headers: { "x-a": "1" } });
const request: RequestLike = rawRequest;
console.log(showRequest(request), showRequest(new FakeRequest()));

// an optional member and a union with null
interface OriginLike { dispatchEvent(event: Event): boolean }
interface MessageLike { type: string; data: unknown; target: OriginLike | null; source?: unknown }
class FakeOrigin implements OriginLike { fakeOnly = 0; dispatchEvent() { return false; } }
class FakeMessage implements MessageLike { fakeOnly = 0; type = "fake"; data: unknown = 0; target: OriginLike | null = new FakeOrigin(); }
function showMessage(message: MessageLike) { return message.type + " " + message.data + " " + (message.target === null ? "null" : typeof message.target.dispatchEvent); }
const origin = new EventTarget();
let received: MessageLike | null = null;
origin.addEventListener("message", event => { received = event as MessageEvent; });
origin.dispatchEvent(new MessageEvent("message", { data: 5 }));
console.log(showMessage(received!), showMessage(new MessageEvent("message", { data: 6 })), showMessage(new FakeMessage()));

// the outer object is pushed into an array of the interface
interface PairsLike { has(name: string): boolean }
interface AddressLike { host: string; searchParams: PairsLike }
class FakePairs implements PairsLike { fakeOnly = 0; has(name: string) { return name === "fake"; } }
class FakeAddress implements AddressLike { fakeOnly = 0; host = "fake"; searchParams: PairsLike = new FakePairs(); }
function showAddress(address: AddressLike) { return address.host + " " + address.searchParams.has("a"); }
const addresses: AddressLike[] = [new FakeAddress()];
addresses.push(new URL("http://h/p?a=1"));
console.log(addresses.map(showAddress).join());
