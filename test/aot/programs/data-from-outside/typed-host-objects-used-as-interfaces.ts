// A host object that satisfies one of the program's interfaces is accepted wherever the interface is used: an annotation, a parameter, a field, an element, a return value, `as`. Each interface also has a program class with one extra member, so no host object matches that class.
import { statSync } from "node:fs";

interface HeadersLike { get(name: string): string | null; has(name: string): boolean }
class FakeHeaders implements HeadersLike { fakeOnly = 0; get(name: string): string | null { return "fake-" + name; } has(name: string) { return false; } }
interface SocketLike { send(data: string): void; close(): void; readyState: number; onmessage: ((e: any) => void) | null }
class FakeSocket implements SocketLike { fakeOnly = 0; readyState = 9; onmessage: ((e: any) => void) | null = null; send(data: string) {} close() {} }
interface RequestLike { method: string; url: string; headers: HeadersLike }
class FakeRequest implements RequestLike { fakeOnly = 0; method = "FAKE"; url = "fake:"; headers: HeadersLike = new FakeHeaders(); }
interface ResponseLike { status: number; ok: boolean; headers: HeadersLike }
class FakeResponse implements ResponseLike { fakeOnly = 0; status = 1; ok = false; headers: HeadersLike = new FakeHeaders(); }
interface ParamsLike { get(name: string): string | null }
class FakeParams implements ParamsLike { fakeOnly = 0; get(name: string): string | null { return "fake-" + name; } }
interface UrlLike { href: string; searchParams: ParamsLike }
class FakeUrl implements UrlLike { fakeOnly = 0; href = "fake:"; searchParams: ParamsLike = new FakeParams(); }
interface BlobLike { size: number; type: string; slice(start?: number, end?: number): BlobLike }
class FakeBlob implements BlobLike { fakeOnly = 0; size = -1; type = "fake"; slice(): BlobLike { return this; } }
interface FileLike { name: string; size: number; lastModified: number }
class FakeFile implements FileLike { fakeOnly = 0; name = "fake"; size = -1; lastModified = 0; }
interface FormLike { get(name: string): unknown; has(name: string): boolean; append(name: string, value: string): void }
class FakeForm implements FormLike { fakeOnly = 0; get(name: string): unknown { return "fake"; } has(name: string) { return false; } append(name: string, value: string) {} }
interface ReadableLike { locked: boolean; cancel(reason?: unknown): Promise<void> }
class FakeReadable implements ReadableLike { fakeOnly = 0; locked = true; async cancel() {} }
interface WritableLike { locked: boolean; abort(reason?: unknown): Promise<void> }
class FakeWritable implements WritableLike { fakeOnly = 0; locked = true; async abort() {} }
interface TransformLike { readable: ReadableLike; writable: WritableLike }
class FakeTransform implements TransformLike { fakeOnly = 0; readable: ReadableLike = new FakeReadable(); writable: WritableLike = new FakeWritable(); }
interface SignalLike { aborted: boolean; reason: unknown }
class FakeSignal implements SignalLike { fakeOnly = 0; aborted = false; reason: unknown = "fake"; }
interface ControllerLike { signal: SignalLike; abort(reason?: unknown): void }
class FakeController implements ControllerLike { fakeOnly = 0; signal: SignalLike = new FakeSignal(); abort() { this.signal.aborted = true; } }
interface EncoderLike { encoding: string; encode(text?: string): BytesLike }
interface BytesLike { length: number; byteLength: number }
class FakeBytes implements BytesLike { fakeOnly = 0; length = -1; byteLength = -2; }
class FakeEncoder implements EncoderLike { fakeOnly = 0; encoding = "fake"; encode(): BytesLike { return new FakeBytes(); } }
interface DecoderLike { encoding: string; fatal: boolean; decode(): string }
class FakeDecoder implements DecoderLike { fakeOnly = 0; encoding = "fake"; fatal = true; decode() { return "fake"; } }
interface TargetLike { dispatchEvent(event: Event): boolean }
class FakeTarget implements TargetLike { fakeOnly = 0; dispatchEvent() { return false; } }
interface MessageLike { type: string; data: unknown; target: TargetLike | null }
class FakeMessage implements MessageLike { fakeOnly = 0; type = "fake"; data: unknown = 0; target: TargetLike | null = new FakeTarget(); }
interface TimerLike { ref(): TimerLike; unref(): TimerLike; hasRef(): boolean }
class FakeTimer implements TimerLike { fakeOnly = 0; ref(): TimerLike { return this; } unref(): TimerLike { return this; } hasRef() { return false; } }
interface StatsLike { size: number; mtime: DateLike; isDirectory(): boolean }
interface DateLike { getTime(): number }
class FakeDate implements DateLike { fakeOnly = 0; getTime() { return -1; } }
class FakeStats implements StatsLike { fakeOnly = 0; size = -1; mtime: DateLike = new FakeDate(); isDirectory() { return false; } }

function probeWebSocket(x: SocketLike): string { const s = typeof x.readyState + String(x.onmessage); x.close(); return s; }
class HolderWebSocket { held: SocketLike; constructor(held: SocketLike) { this.held = held; } }
function typedWebSocket(): SocketLike { return new WebSocket("ws://127.0.0.1:9"); }
{
  const annotated: SocketLike = new WebSocket("ws://127.0.0.1:9");
  const list: SocketLike[] = [new FakeSocket(), new WebSocket("ws://127.0.0.1:9")];
  list.push(new WebSocket("ws://127.0.0.1:9"));
  console.log("WebSocket", probeWebSocket(annotated), probeWebSocket(new WebSocket("ws://127.0.0.1:9")), probeWebSocket(new HolderWebSocket(new WebSocket("ws://127.0.0.1:9")).held), list.map(probeWebSocket).join(), probeWebSocket(typedWebSocket()), probeWebSocket(new WebSocket("ws://127.0.0.1:9") as SocketLike));
}
function probeRequest(x: RequestLike): string { return x.method + x.url + x.headers.get("x-a"); }
class HolderRequest { held: RequestLike; constructor(held: RequestLike) { this.held = held; } }
function typedRequest(): RequestLike { return new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } }); }
{
  const annotated: RequestLike = new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } });
  const list: RequestLike[] = [new FakeRequest(), new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } })];
  list.push(new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } }));
  console.log("Request", probeRequest(annotated), probeRequest(new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } })), probeRequest(new HolderRequest(new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } })).held), list.map(probeRequest).join(), probeRequest(typedRequest()), probeRequest(new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } }) as RequestLike));
}
function probeResponse(x: ResponseLike): string { return x.status + String(x.ok) + x.headers.get("x-a"); }
class HolderResponse { held: ResponseLike; constructor(held: ResponseLike) { this.held = held; } }
function typedResponse(): ResponseLike { return new Response("b", { status: 201, headers: { "x-a": "s" } }); }
{
  const annotated: ResponseLike = new Response("b", { status: 201, headers: { "x-a": "s" } });
  const list: ResponseLike[] = [new FakeResponse(), new Response("b", { status: 201, headers: { "x-a": "s" } })];
  list.push(new Response("b", { status: 201, headers: { "x-a": "s" } }));
  console.log("Response", probeResponse(annotated), probeResponse(new Response("b", { status: 201, headers: { "x-a": "s" } })), probeResponse(new HolderResponse(new Response("b", { status: 201, headers: { "x-a": "s" } })).held), list.map(probeResponse).join(), probeResponse(typedResponse()), probeResponse(new Response("b", { status: 201, headers: { "x-a": "s" } }) as ResponseLike));
}
function probeHeaders(x: HeadersLike): string { return x.get("x-a") + String(x.has("x-b")); }
class HolderHeaders { held: HeadersLike; constructor(held: HeadersLike) { this.held = held; } }
function typedHeaders(): HeadersLike { return new Headers({ "x-a": "h" }); }
{
  const annotated: HeadersLike = new Headers({ "x-a": "h" });
  const list: HeadersLike[] = [new FakeHeaders(), new Headers({ "x-a": "h" })];
  list.push(new Headers({ "x-a": "h" }));
  console.log("Headers", probeHeaders(annotated), probeHeaders(new Headers({ "x-a": "h" })), probeHeaders(new HolderHeaders(new Headers({ "x-a": "h" })).held), list.map(probeHeaders).join(), probeHeaders(typedHeaders()), probeHeaders(new Headers({ "x-a": "h" }) as HeadersLike));
}
function probeURL(x: UrlLike): string { return x.href + x.searchParams.get("a"); }
class HolderURL { held: UrlLike; constructor(held: UrlLike) { this.held = held; } }
function typedURL(): UrlLike { return new URL("http://h/p?a=1"); }
{
  const annotated: UrlLike = new URL("http://h/p?a=1");
  const list: UrlLike[] = [new FakeUrl(), new URL("http://h/p?a=1")];
  list.push(new URL("http://h/p?a=1"));
  console.log("URL", probeURL(annotated), probeURL(new URL("http://h/p?a=1")), probeURL(new HolderURL(new URL("http://h/p?a=1")).held), list.map(probeURL).join(), probeURL(typedURL()), probeURL(new URL("http://h/p?a=1") as UrlLike));
}
function probeURLSearchParams(x: ParamsLike): string { return String(x.get("a")); }
class HolderURLSearchParams { held: ParamsLike; constructor(held: ParamsLike) { this.held = held; } }
function typedURLSearchParams(): ParamsLike { return new URLSearchParams("a=2"); }
{
  const annotated: ParamsLike = new URLSearchParams("a=2");
  const list: ParamsLike[] = [new FakeParams(), new URLSearchParams("a=2")];
  list.push(new URLSearchParams("a=2"));
  console.log("URLSearchParams", probeURLSearchParams(annotated), probeURLSearchParams(new URLSearchParams("a=2")), probeURLSearchParams(new HolderURLSearchParams(new URLSearchParams("a=2")).held), list.map(probeURLSearchParams).join(), probeURLSearchParams(typedURLSearchParams()), probeURLSearchParams(new URLSearchParams("a=2") as ParamsLike));
}
function probeBlob(x: BlobLike): string { return x.size + x.type + x.slice(1, 3).size; }
class HolderBlob { held: BlobLike; constructor(held: BlobLike) { this.held = held; } }
function typedBlob(): BlobLike { return new Blob(["abcd"], { type: "text/x" }); }
{
  const annotated: BlobLike = new Blob(["abcd"], { type: "text/x" });
  const list: BlobLike[] = [new FakeBlob(), new Blob(["abcd"], { type: "text/x" })];
  list.push(new Blob(["abcd"], { type: "text/x" }));
  console.log("Blob", probeBlob(annotated), probeBlob(new Blob(["abcd"], { type: "text/x" })), probeBlob(new HolderBlob(new Blob(["abcd"], { type: "text/x" })).held), list.map(probeBlob).join(), probeBlob(typedBlob()), probeBlob(new Blob(["abcd"], { type: "text/x" }) as BlobLike));
}
function probeFile(x: FileLike): string { return x.name + x.size + x.lastModified; }
class HolderFile { held: FileLike; constructor(held: FileLike) { this.held = held; } }
function typedFile(): FileLike { return new File(["ab"], "f.txt", { lastModified: 5 }); }
{
  const annotated: FileLike = new File(["ab"], "f.txt", { lastModified: 5 });
  const list: FileLike[] = [new FakeFile(), new File(["ab"], "f.txt", { lastModified: 5 })];
  list.push(new File(["ab"], "f.txt", { lastModified: 5 }));
  console.log("File", probeFile(annotated), probeFile(new File(["ab"], "f.txt", { lastModified: 5 })), probeFile(new HolderFile(new File(["ab"], "f.txt", { lastModified: 5 })).held), list.map(probeFile).join(), probeFile(typedFile()), probeFile(new File(["ab"], "f.txt", { lastModified: 5 }) as FileLike));
}
function probeFormData(x: FormLike): string { x.append("k", "v"); return String(x.get("k")) + x.has("k"); }
class HolderFormData { held: FormLike; constructor(held: FormLike) { this.held = held; } }
function typedFormData(): FormLike { return new FormData(); }
{
  const annotated: FormLike = new FormData();
  const list: FormLike[] = [new FakeForm(), new FormData()];
  list.push(new FormData());
  console.log("FormData", probeFormData(annotated), probeFormData(new FormData()), probeFormData(new HolderFormData(new FormData()).held), list.map(probeFormData).join(), probeFormData(typedFormData()), probeFormData(new FormData() as FormLike));
}
function probeReadableStream(x: ReadableLike): string { return String(x.locked); }
class HolderReadableStream { held: ReadableLike; constructor(held: ReadableLike) { this.held = held; } }
function typedReadableStream(): ReadableLike { return new ReadableStream(); }
{
  const annotated: ReadableLike = new ReadableStream();
  const list: ReadableLike[] = [new FakeReadable(), new ReadableStream()];
  list.push(new ReadableStream());
  console.log("ReadableStream", probeReadableStream(annotated), probeReadableStream(new ReadableStream()), probeReadableStream(new HolderReadableStream(new ReadableStream()).held), list.map(probeReadableStream).join(), probeReadableStream(typedReadableStream()), probeReadableStream(new ReadableStream() as ReadableLike));
}
function probeWritableStream(x: WritableLike): string { return String(x.locked); }
class HolderWritableStream { held: WritableLike; constructor(held: WritableLike) { this.held = held; } }
function typedWritableStream(): WritableLike { return new WritableStream(); }
{
  const annotated: WritableLike = new WritableStream();
  const list: WritableLike[] = [new FakeWritable(), new WritableStream()];
  list.push(new WritableStream());
  console.log("WritableStream", probeWritableStream(annotated), probeWritableStream(new WritableStream()), probeWritableStream(new HolderWritableStream(new WritableStream()).held), list.map(probeWritableStream).join(), probeWritableStream(typedWritableStream()), probeWritableStream(new WritableStream() as WritableLike));
}
function probeTransformStream(x: TransformLike): string { return String(x.readable.locked) + x.writable.locked; }
class HolderTransformStream { held: TransformLike; constructor(held: TransformLike) { this.held = held; } }
function typedTransformStream(): TransformLike { return new TransformStream(); }
{
  const annotated: TransformLike = new TransformStream();
  const list: TransformLike[] = [new FakeTransform(), new TransformStream()];
  list.push(new TransformStream());
  console.log("TransformStream", probeTransformStream(annotated), probeTransformStream(new TransformStream()), probeTransformStream(new HolderTransformStream(new TransformStream()).held), list.map(probeTransformStream).join(), probeTransformStream(typedTransformStream()), probeTransformStream(new TransformStream() as TransformLike));
}
function probeAbortController(x: ControllerLike): string { const before = x.signal.aborted; x.abort("why"); return String(before) + x.signal.aborted + x.signal.reason; }
class HolderAbortController { held: ControllerLike; constructor(held: ControllerLike) { this.held = held; } }
function typedAbortController(): ControllerLike { return new AbortController(); }
{
  const annotated: ControllerLike = new AbortController();
  const list: ControllerLike[] = [new FakeController(), new AbortController()];
  list.push(new AbortController());
  console.log("AbortController", probeAbortController(annotated), probeAbortController(new AbortController()), probeAbortController(new HolderAbortController(new AbortController()).held), list.map(probeAbortController).join(), probeAbortController(typedAbortController()), probeAbortController(new AbortController() as ControllerLike));
}
function probeAbortSignal(x: SignalLike): string { return String(x.aborted) + x.reason; }
class HolderAbortSignal { held: SignalLike; constructor(held: SignalLike) { this.held = held; } }
function typedAbortSignal(): SignalLike { return AbortSignal.abort("gone"); }
{
  const annotated: SignalLike = AbortSignal.abort("gone");
  const list: SignalLike[] = [new FakeSignal(), AbortSignal.abort("gone")];
  list.push(AbortSignal.abort("gone"));
  console.log("AbortSignal", probeAbortSignal(annotated), probeAbortSignal(AbortSignal.abort("gone")), probeAbortSignal(new HolderAbortSignal(AbortSignal.abort("gone")).held), list.map(probeAbortSignal).join(), probeAbortSignal(typedAbortSignal()), probeAbortSignal(AbortSignal.abort("gone") as SignalLike));
}
function probeTextEncoder(x: EncoderLike): string { return x.encoding + x.encode("abc").length; }
class HolderTextEncoder { held: EncoderLike; constructor(held: EncoderLike) { this.held = held; } }
function typedTextEncoder(): EncoderLike { return new TextEncoder(); }
{
  const annotated: EncoderLike = new TextEncoder();
  const list: EncoderLike[] = [new FakeEncoder(), new TextEncoder()];
  list.push(new TextEncoder());
  console.log("TextEncoder", probeTextEncoder(annotated), probeTextEncoder(new TextEncoder()), probeTextEncoder(new HolderTextEncoder(new TextEncoder()).held), list.map(probeTextEncoder).join(), probeTextEncoder(typedTextEncoder()), probeTextEncoder(new TextEncoder() as EncoderLike));
}
function probeTextDecoder(x: DecoderLike): string { return x.encoding + x.fatal + x.decode(); }
class HolderTextDecoder { held: DecoderLike; constructor(held: DecoderLike) { this.held = held; } }
function typedTextDecoder(): DecoderLike { return new TextDecoder(); }
{
  const annotated: DecoderLike = new TextDecoder();
  const list: DecoderLike[] = [new FakeDecoder(), new TextDecoder()];
  list.push(new TextDecoder());
  console.log("TextDecoder", probeTextDecoder(annotated), probeTextDecoder(new TextDecoder()), probeTextDecoder(new HolderTextDecoder(new TextDecoder()).held), list.map(probeTextDecoder).join(), probeTextDecoder(typedTextDecoder()), probeTextDecoder(new TextDecoder() as DecoderLike));
}
function probeMessageEvent(x: MessageLike): string { return x.type + x.data + (x.target === null); }
class HolderMessageEvent { held: MessageLike; constructor(held: MessageLike) { this.held = held; } }
function typedMessageEvent(): MessageLike { return new MessageEvent("message", { data: "d" }); }
{
  const annotated: MessageLike = new MessageEvent("message", { data: "d" });
  const list: MessageLike[] = [new FakeMessage(), new MessageEvent("message", { data: "d" })];
  list.push(new MessageEvent("message", { data: "d" }));
  console.log("MessageEvent", probeMessageEvent(annotated), probeMessageEvent(new MessageEvent("message", { data: "d" })), probeMessageEvent(new HolderMessageEvent(new MessageEvent("message", { data: "d" })).held), list.map(probeMessageEvent).join(), probeMessageEvent(typedMessageEvent()), probeMessageEvent(new MessageEvent("message", { data: "d" }) as MessageLike));
}
function probeEventTarget(x: TargetLike): string { return String(x.dispatchEvent(new Event("e"))); }
class HolderEventTarget { held: TargetLike; constructor(held: TargetLike) { this.held = held; } }
function typedEventTarget(): TargetLike { return new EventTarget(); }
{
  const annotated: TargetLike = new EventTarget();
  const list: TargetLike[] = [new FakeTarget(), new EventTarget()];
  list.push(new EventTarget());
  console.log("EventTarget", probeEventTarget(annotated), probeEventTarget(new EventTarget()), probeEventTarget(new HolderEventTarget(new EventTarget()).held), list.map(probeEventTarget).join(), probeEventTarget(typedEventTarget()), probeEventTarget(new EventTarget() as TargetLike));
}
function probeBuffer(x: BytesLike): string { return String(x.length) + x.byteLength; }
class HolderBuffer { held: BytesLike; constructor(held: BytesLike) { this.held = held; } }
function typedBuffer(): BytesLike { return Buffer.from("abcd"); }
{
  const annotated: BytesLike = Buffer.from("abcd");
  const list: BytesLike[] = [new FakeBytes(), Buffer.from("abcd")];
  list.push(Buffer.from("abcd"));
  console.log("Buffer", probeBuffer(annotated), probeBuffer(Buffer.from("abcd")), probeBuffer(new HolderBuffer(Buffer.from("abcd")).held), list.map(probeBuffer).join(), probeBuffer(typedBuffer()), probeBuffer(Buffer.from("abcd") as BytesLike));
}
function probeBunfile(x: BlobLike): string { return typeof x.size + x.type; }
class HolderBunfile { held: BlobLike; constructor(held: BlobLike) { this.held = held; } }
function typedBunfile(): BlobLike { return Bun.file("/nowhere/at-all.txt"); }
{
  const annotated: BlobLike = Bun.file("/nowhere/at-all.txt");
  const list: BlobLike[] = [new FakeBlob(), Bun.file("/nowhere/at-all.txt")];
  list.push(Bun.file("/nowhere/at-all.txt"));
  console.log("Bun.file", probeBunfile(annotated), probeBunfile(Bun.file("/nowhere/at-all.txt")), probeBunfile(new HolderBunfile(Bun.file("/nowhere/at-all.txt")).held), list.map(probeBunfile).join(), probeBunfile(typedBunfile()), probeBunfile(Bun.file("/nowhere/at-all.txt") as BlobLike));
}
function probeTimer(x: TimerLike): string { return String(x.unref().hasRef()); }
class HolderTimer { held: TimerLike; constructor(held: TimerLike) { this.held = held; } }
function typedTimer(): TimerLike { return setTimeout(() => {}, 0); }
{
  const annotated: TimerLike = setTimeout(() => {}, 0);
  const list: TimerLike[] = [new FakeTimer(), setTimeout(() => {}, 0)];
  list.push(setTimeout(() => {}, 0));
  console.log("Timer", probeTimer(annotated), probeTimer(setTimeout(() => {}, 0)), probeTimer(new HolderTimer(setTimeout(() => {}, 0)).held), list.map(probeTimer).join(), probeTimer(typedTimer()), probeTimer(setTimeout(() => {}, 0) as TimerLike));
}
function probeStats(x: StatsLike): string { return typeof x.size + typeof x.mtime.getTime() + x.isDirectory(); }
class HolderStats { held: StatsLike; constructor(held: StatsLike) { this.held = held; } }
function typedStats(): StatsLike { return statSync("/"); }
{
  const annotated: StatsLike = statSync("/");
  const list: StatsLike[] = [new FakeStats(), statSync("/")];
  list.push(statSync("/"));
  console.log("Stats", probeStats(annotated), probeStats(statSync("/")), probeStats(new HolderStats(statSync("/")).held), list.map(probeStats).join(), probeStats(typedStats()), probeStats(statSync("/") as StatsLike));
}
