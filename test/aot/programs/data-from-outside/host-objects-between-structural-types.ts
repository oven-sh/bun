// A host object typed as its own class is assigned to a local with a structural type, then passed on to a second, identical structural type. Each case has its own host class, its own pair of types, and a program class with one extra member so that the host object never matches that class. The output must match plain Bun.

// an annotated constant of the host's type
type UrlA = { readonly href: string; readonly host: string };
type UrlB = { readonly href: string; readonly host: string };
class FakeUrl { fakeOnly = 0; href = "fake:"; host = "fake"; }
function useUrl(x: UrlB) { return x.href + x.host; }
const rawUrl: URL = new URL("http://h/p");
const url: UrlA = rawUrl;
console.log(useUrl(url), useUrl(new FakeUrl()));

// the result of a function
type HeadersA = { get(name: string): string | null; has(name: string): boolean; count?: number };
type HeadersB = { get(name: string): string | null; has(name: string): boolean; count?: number };
class FakeHeaders { fakeOnly = 0; count = 1; get(name: string): string | null { return "fake"; } has(name: string) { return false; } }
function useHeaders(x: HeadersB) { return x.get("a") + String(x.has("b")) + x.count; }
function makeHeaders(): Headers { return new Headers({ a: "1" }); }
const headers: HeadersA = makeHeaders();
console.log(useHeaders(headers), useHeaders(new FakeHeaders()));

// a field
type ResponseA = { readonly status: number; readonly ok: boolean };
type ResponseB = { readonly status: number; readonly ok: boolean };
class FakeResponse { fakeOnly = 0; status = 1; ok = false; }
function useResponse(x: ResponseB) { return x.status + String(x.ok); }
class Box { constructor(public raw: Response) {} }
const response: ResponseA = new Box(new Response("", { status: 201 })).raw;
console.log(useResponse(response), useResponse(new FakeResponse()));

// an element
type BlobA = { readonly size: number; readonly type: string };
type BlobB = { readonly size: number; readonly type: string };
class FakeBlob { fakeOnly = 0; size = -1; type = "fake"; }
function useBlob(x: BlobB) { return x.size + x.type; }
const blobs: Blob[] = [new Blob(["abc"], { type: "text/x" })];
const blob: BlobA = blobs[0];
console.log(useBlob(blob), useBlob(new FakeBlob()));

// the class under another name
type DecoderA = { readonly encoding: string; readonly fatal: boolean };
type DecoderB = { readonly encoding: string; readonly fatal: boolean };
class FakeDecoder { fakeOnly = 0; encoding = "fake"; fatal = true; }
function useDecoder(x: DecoderB) { return x.encoding + x.fatal; }
const Decoder = TextDecoder;
const decoder: DecoderA = new Decoder();
console.log(useDecoder(decoder), useDecoder(new FakeDecoder()));

// a class of the program that extends a class of the host
type TargetA = { dispatchEvent(event: Event): boolean; label: string };
type TargetB = { dispatchEvent(event: Event): boolean; label: string };
class FakeTarget { fakeOnly = 0; label = "fake"; dispatchEvent(event: Event) { return false; } }
function useTarget(x: TargetB) { return x.label + x.dispatchEvent(new Event("e")); }
class Mine extends EventTarget { label = "mine"; }
const target: TargetA = new Mine();
console.log(useTarget(target), useTarget(new FakeTarget()));

// the class taken out of globalThis
type EncoderA = { readonly encoding: string; tag?: string };
type EncoderB = { readonly encoding: string; tag?: string };
class FakeEncoder { fakeOnly = 0; encoding = "fake"; tag = "t"; }
function useEncoder(x: EncoderB) { return x.encoding + x.tag; }
const { TextEncoder: Encoder } = globalThis;
const encoder: EncoderA = new Encoder();
console.log(useEncoder(encoder), useEncoder(new FakeEncoder()));

// the class read off globalThis by a string
type RequestA = { readonly method: string; readonly url: string };
type RequestB = { readonly method: string; readonly url: string };
class FakeRequest { fakeOnly = 0; method = "FAKE"; url = "fake:"; }
function useRequest(x: RequestB) { return x.method + x.url; }
const request: RequestA = new globalThis["Request"]("http://h/r");
console.log(useRequest(request), useRequest(new FakeRequest()));
