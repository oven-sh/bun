// A host object typed `any` that satisfies one of the program's interfaces is accepted wherever the interface is used: an annotation, a parameter, a field, an element, a return value, `as`, a map. No host object is used under its own type here. Each interface also has a program class with one extra member, so no host object matches that class.
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
function untypedWebSocket(): any { return new WebSocket("ws://127.0.0.1:9"); }
function throughWebSocket(): SocketLike { return untypedWebSocket(); }
{
  const annotated: SocketLike = untypedWebSocket();
  const list: SocketLike[] = [new FakeSocket(), untypedWebSocket()];
  list.push(untypedWebSocket());
  const map = new Map<string, SocketLike>();
  map.set("k", untypedWebSocket());
  console.log("WebSocket", probeWebSocket(annotated), probeWebSocket(untypedWebSocket()), probeWebSocket(new HolderWebSocket(untypedWebSocket()).held), list.map(probeWebSocket).join(), probeWebSocket(throughWebSocket()), probeWebSocket(untypedWebSocket() as SocketLike), probeWebSocket(map.get("k")!));
}
function probeRequest(x: RequestLike): string { return x.method + x.url + x.headers.get("x-a"); }
class HolderRequest { held: RequestLike; constructor(held: RequestLike) { this.held = held; } }
function untypedRequest(): any { return new Request("http://h/r", { method: "POST", headers: { "x-a": "r" } }); }
function throughRequest(): RequestLike { return untypedRequest(); }
{
  const annotated: RequestLike = untypedRequest();
  const list: RequestLike[] = [new FakeRequest(), untypedRequest()];
  list.push(untypedRequest());
  const map = new Map<string, RequestLike>();
  map.set("k", untypedRequest());
  console.log("Request", probeRequest(annotated), probeRequest(untypedRequest()), probeRequest(new HolderRequest(untypedRequest()).held), list.map(probeRequest).join(), probeRequest(throughRequest()), probeRequest(untypedRequest() as RequestLike), probeRequest(map.get("k")!));
}
function probeResponse(x: ResponseLike): string { return x.status + String(x.ok) + x.headers.get("x-a"); }
class HolderResponse { held: ResponseLike; constructor(held: ResponseLike) { this.held = held; } }
function untypedResponse(): any { return new Response("b", { status: 201, headers: { "x-a": "s" } }); }
function throughResponse(): ResponseLike { return untypedResponse(); }
{
  const annotated: ResponseLike = untypedResponse();
  const list: ResponseLike[] = [new FakeResponse(), untypedResponse()];
  list.push(untypedResponse());
  const map = new Map<string, ResponseLike>();
  map.set("k", untypedResponse());
  console.log("Response", probeResponse(annotated), probeResponse(untypedResponse()), probeResponse(new HolderResponse(untypedResponse()).held), list.map(probeResponse).join(), probeResponse(throughResponse()), probeResponse(untypedResponse() as ResponseLike), probeResponse(map.get("k")!));
}
function probeHeaders(x: HeadersLike): string { return x.get("x-a") + String(x.has("x-b")); }
class HolderHeaders { held: HeadersLike; constructor(held: HeadersLike) { this.held = held; } }
function untypedHeaders(): any { return new Headers({ "x-a": "h" }); }
function throughHeaders(): HeadersLike { return untypedHeaders(); }
{
  const annotated: HeadersLike = untypedHeaders();
  const list: HeadersLike[] = [new FakeHeaders(), untypedHeaders()];
  list.push(untypedHeaders());
  const map = new Map<string, HeadersLike>();
  map.set("k", untypedHeaders());
  console.log("Headers", probeHeaders(annotated), probeHeaders(untypedHeaders()), probeHeaders(new HolderHeaders(untypedHeaders()).held), list.map(probeHeaders).join(), probeHeaders(throughHeaders()), probeHeaders(untypedHeaders() as HeadersLike), probeHeaders(map.get("k")!));
}
function probeURL(x: UrlLike): string { return x.href + x.searchParams.get("a"); }
class HolderURL { held: UrlLike; constructor(held: UrlLike) { this.held = held; } }
function untypedURL(): any { return new URL("http://h/p?a=1"); }
function throughURL(): UrlLike { return untypedURL(); }
{
  const annotated: UrlLike = untypedURL();
  const list: UrlLike[] = [new FakeUrl(), untypedURL()];
  list.push(untypedURL());
  const map = new Map<string, UrlLike>();
  map.set("k", untypedURL());
  console.log("URL", probeURL(annotated), probeURL(untypedURL()), probeURL(new HolderURL(untypedURL()).held), list.map(probeURL).join(), probeURL(throughURL()), probeURL(untypedURL() as UrlLike), probeURL(map.get("k")!));
}
function probeURLSearchParams(x: ParamsLike): string { return String(x.get("a")); }
class HolderURLSearchParams { held: ParamsLike; constructor(held: ParamsLike) { this.held = held; } }
function untypedURLSearchParams(): any { return new URLSearchParams("a=2"); }
function throughURLSearchParams(): ParamsLike { return untypedURLSearchParams(); }
{
  const annotated: ParamsLike = untypedURLSearchParams();
  const list: ParamsLike[] = [new FakeParams(), untypedURLSearchParams()];
  list.push(untypedURLSearchParams());
  const map = new Map<string, ParamsLike>();
  map.set("k", untypedURLSearchParams());
  console.log("URLSearchParams", probeURLSearchParams(annotated), probeURLSearchParams(untypedURLSearchParams()), probeURLSearchParams(new HolderURLSearchParams(untypedURLSearchParams()).held), list.map(probeURLSearchParams).join(), probeURLSearchParams(throughURLSearchParams()), probeURLSearchParams(untypedURLSearchParams() as ParamsLike), probeURLSearchParams(map.get("k")!));
}
function probeBlob(x: BlobLike): string { return x.size + x.type + x.slice(1, 3).size; }
class HolderBlob { held: BlobLike; constructor(held: BlobLike) { this.held = held; } }
function untypedBlob(): any { return new Blob(["abcd"], { type: "text/x" }); }
function throughBlob(): BlobLike { return untypedBlob(); }
{
  const annotated: BlobLike = untypedBlob();
  const list: BlobLike[] = [new FakeBlob(), untypedBlob()];
  list.push(untypedBlob());
  const map = new Map<string, BlobLike>();
  map.set("k", untypedBlob());
  console.log("Blob", probeBlob(annotated), probeBlob(untypedBlob()), probeBlob(new HolderBlob(untypedBlob()).held), list.map(probeBlob).join(), probeBlob(throughBlob()), probeBlob(untypedBlob() as BlobLike), probeBlob(map.get("k")!));
}
function probeFile(x: FileLike): string { return x.name + x.size + x.lastModified; }
class HolderFile { held: FileLike; constructor(held: FileLike) { this.held = held; } }
function untypedFile(): any { return new File(["ab"], "f.txt", { lastModified: 5 }); }
function throughFile(): FileLike { return untypedFile(); }
{
  const annotated: FileLike = untypedFile();
  const list: FileLike[] = [new FakeFile(), untypedFile()];
  list.push(untypedFile());
  const map = new Map<string, FileLike>();
  map.set("k", untypedFile());
  console.log("File", probeFile(annotated), probeFile(untypedFile()), probeFile(new HolderFile(untypedFile()).held), list.map(probeFile).join(), probeFile(throughFile()), probeFile(untypedFile() as FileLike), probeFile(map.get("k")!));
}
function probeFormData(x: FormLike): string { x.append("k", "v"); return String(x.get("k")) + x.has("k"); }
class HolderFormData { held: FormLike; constructor(held: FormLike) { this.held = held; } }
function untypedFormData(): any { return new FormData(); }
function throughFormData(): FormLike { return untypedFormData(); }
{
  const annotated: FormLike = untypedFormData();
  const list: FormLike[] = [new FakeForm(), untypedFormData()];
  list.push(untypedFormData());
  const map = new Map<string, FormLike>();
  map.set("k", untypedFormData());
  console.log("FormData", probeFormData(annotated), probeFormData(untypedFormData()), probeFormData(new HolderFormData(untypedFormData()).held), list.map(probeFormData).join(), probeFormData(throughFormData()), probeFormData(untypedFormData() as FormLike), probeFormData(map.get("k")!));
}
function probeReadableStream(x: ReadableLike): string { return String(x.locked); }
class HolderReadableStream { held: ReadableLike; constructor(held: ReadableLike) { this.held = held; } }
function untypedReadableStream(): any { return new ReadableStream(); }
function throughReadableStream(): ReadableLike { return untypedReadableStream(); }
{
  const annotated: ReadableLike = untypedReadableStream();
  const list: ReadableLike[] = [new FakeReadable(), untypedReadableStream()];
  list.push(untypedReadableStream());
  const map = new Map<string, ReadableLike>();
  map.set("k", untypedReadableStream());
  console.log("ReadableStream", probeReadableStream(annotated), probeReadableStream(untypedReadableStream()), probeReadableStream(new HolderReadableStream(untypedReadableStream()).held), list.map(probeReadableStream).join(), probeReadableStream(throughReadableStream()), probeReadableStream(untypedReadableStream() as ReadableLike), probeReadableStream(map.get("k")!));
}
function probeWritableStream(x: WritableLike): string { return String(x.locked); }
class HolderWritableStream { held: WritableLike; constructor(held: WritableLike) { this.held = held; } }
function untypedWritableStream(): any { return new WritableStream(); }
function throughWritableStream(): WritableLike { return untypedWritableStream(); }
{
  const annotated: WritableLike = untypedWritableStream();
  const list: WritableLike[] = [new FakeWritable(), untypedWritableStream()];
  list.push(untypedWritableStream());
  const map = new Map<string, WritableLike>();
  map.set("k", untypedWritableStream());
  console.log("WritableStream", probeWritableStream(annotated), probeWritableStream(untypedWritableStream()), probeWritableStream(new HolderWritableStream(untypedWritableStream()).held), list.map(probeWritableStream).join(), probeWritableStream(throughWritableStream()), probeWritableStream(untypedWritableStream() as WritableLike), probeWritableStream(map.get("k")!));
}
function probeTransformStream(x: TransformLike): string { return String(x.readable.locked) + x.writable.locked; }
class HolderTransformStream { held: TransformLike; constructor(held: TransformLike) { this.held = held; } }
function untypedTransformStream(): any { return new TransformStream(); }
function throughTransformStream(): TransformLike { return untypedTransformStream(); }
{
  const annotated: TransformLike = untypedTransformStream();
  const list: TransformLike[] = [new FakeTransform(), untypedTransformStream()];
  list.push(untypedTransformStream());
  const map = new Map<string, TransformLike>();
  map.set("k", untypedTransformStream());
  console.log("TransformStream", probeTransformStream(annotated), probeTransformStream(untypedTransformStream()), probeTransformStream(new HolderTransformStream(untypedTransformStream()).held), list.map(probeTransformStream).join(), probeTransformStream(throughTransformStream()), probeTransformStream(untypedTransformStream() as TransformLike), probeTransformStream(map.get("k")!));
}
function probeAbortController(x: ControllerLike): string { const before = x.signal.aborted; x.abort("why"); return String(before) + x.signal.aborted + x.signal.reason; }
class HolderAbortController { held: ControllerLike; constructor(held: ControllerLike) { this.held = held; } }
function untypedAbortController(): any { return new AbortController(); }
function throughAbortController(): ControllerLike { return untypedAbortController(); }
{
  const annotated: ControllerLike = untypedAbortController();
  const list: ControllerLike[] = [new FakeController(), untypedAbortController()];
  list.push(untypedAbortController());
  const map = new Map<string, ControllerLike>();
  map.set("k", untypedAbortController());
  console.log("AbortController", probeAbortController(annotated), probeAbortController(untypedAbortController()), probeAbortController(new HolderAbortController(untypedAbortController()).held), list.map(probeAbortController).join(), probeAbortController(throughAbortController()), probeAbortController(untypedAbortController() as ControllerLike), probeAbortController(map.get("k")!));
}
function probeAbortSignal(x: SignalLike): string { return String(x.aborted) + x.reason; }
class HolderAbortSignal { held: SignalLike; constructor(held: SignalLike) { this.held = held; } }
function untypedAbortSignal(): any { return AbortSignal.abort("gone"); }
function throughAbortSignal(): SignalLike { return untypedAbortSignal(); }
{
  const annotated: SignalLike = untypedAbortSignal();
  const list: SignalLike[] = [new FakeSignal(), untypedAbortSignal()];
  list.push(untypedAbortSignal());
  const map = new Map<string, SignalLike>();
  map.set("k", untypedAbortSignal());
  console.log("AbortSignal", probeAbortSignal(annotated), probeAbortSignal(untypedAbortSignal()), probeAbortSignal(new HolderAbortSignal(untypedAbortSignal()).held), list.map(probeAbortSignal).join(), probeAbortSignal(throughAbortSignal()), probeAbortSignal(untypedAbortSignal() as SignalLike), probeAbortSignal(map.get("k")!));
}
function probeTextEncoder(x: EncoderLike): string { return x.encoding + x.encode("abc").length; }
class HolderTextEncoder { held: EncoderLike; constructor(held: EncoderLike) { this.held = held; } }
function untypedTextEncoder(): any { return new TextEncoder(); }
function throughTextEncoder(): EncoderLike { return untypedTextEncoder(); }
{
  const annotated: EncoderLike = untypedTextEncoder();
  const list: EncoderLike[] = [new FakeEncoder(), untypedTextEncoder()];
  list.push(untypedTextEncoder());
  const map = new Map<string, EncoderLike>();
  map.set("k", untypedTextEncoder());
  console.log("TextEncoder", probeTextEncoder(annotated), probeTextEncoder(untypedTextEncoder()), probeTextEncoder(new HolderTextEncoder(untypedTextEncoder()).held), list.map(probeTextEncoder).join(), probeTextEncoder(throughTextEncoder()), probeTextEncoder(untypedTextEncoder() as EncoderLike), probeTextEncoder(map.get("k")!));
}
function probeTextDecoder(x: DecoderLike): string { return x.encoding + x.fatal + x.decode(); }
class HolderTextDecoder { held: DecoderLike; constructor(held: DecoderLike) { this.held = held; } }
function untypedTextDecoder(): any { return new TextDecoder(); }
function throughTextDecoder(): DecoderLike { return untypedTextDecoder(); }
{
  const annotated: DecoderLike = untypedTextDecoder();
  const list: DecoderLike[] = [new FakeDecoder(), untypedTextDecoder()];
  list.push(untypedTextDecoder());
  const map = new Map<string, DecoderLike>();
  map.set("k", untypedTextDecoder());
  console.log("TextDecoder", probeTextDecoder(annotated), probeTextDecoder(untypedTextDecoder()), probeTextDecoder(new HolderTextDecoder(untypedTextDecoder()).held), list.map(probeTextDecoder).join(), probeTextDecoder(throughTextDecoder()), probeTextDecoder(untypedTextDecoder() as DecoderLike), probeTextDecoder(map.get("k")!));
}
function probeMessageEvent(x: MessageLike): string { return x.type + x.data + (x.target === null); }
class HolderMessageEvent { held: MessageLike; constructor(held: MessageLike) { this.held = held; } }
function untypedMessageEvent(): any { return new MessageEvent("message", { data: "d" }); }
function throughMessageEvent(): MessageLike { return untypedMessageEvent(); }
{
  const annotated: MessageLike = untypedMessageEvent();
  const list: MessageLike[] = [new FakeMessage(), untypedMessageEvent()];
  list.push(untypedMessageEvent());
  const map = new Map<string, MessageLike>();
  map.set("k", untypedMessageEvent());
  console.log("MessageEvent", probeMessageEvent(annotated), probeMessageEvent(untypedMessageEvent()), probeMessageEvent(new HolderMessageEvent(untypedMessageEvent()).held), list.map(probeMessageEvent).join(), probeMessageEvent(throughMessageEvent()), probeMessageEvent(untypedMessageEvent() as MessageLike), probeMessageEvent(map.get("k")!));
}
function probeEventTarget(x: TargetLike): string { return String(x.dispatchEvent(new Event("e"))); }
class HolderEventTarget { held: TargetLike; constructor(held: TargetLike) { this.held = held; } }
function untypedEventTarget(): any { return new EventTarget(); }
function throughEventTarget(): TargetLike { return untypedEventTarget(); }
{
  const annotated: TargetLike = untypedEventTarget();
  const list: TargetLike[] = [new FakeTarget(), untypedEventTarget()];
  list.push(untypedEventTarget());
  const map = new Map<string, TargetLike>();
  map.set("k", untypedEventTarget());
  console.log("EventTarget", probeEventTarget(annotated), probeEventTarget(untypedEventTarget()), probeEventTarget(new HolderEventTarget(untypedEventTarget()).held), list.map(probeEventTarget).join(), probeEventTarget(throughEventTarget()), probeEventTarget(untypedEventTarget() as TargetLike), probeEventTarget(map.get("k")!));
}
function probeBuffer(x: BytesLike): string { return String(x.length) + x.byteLength; }
class HolderBuffer { held: BytesLike; constructor(held: BytesLike) { this.held = held; } }
function untypedBuffer(): any { return Buffer.from("abcd"); }
function throughBuffer(): BytesLike { return untypedBuffer(); }
{
  const annotated: BytesLike = untypedBuffer();
  const list: BytesLike[] = [new FakeBytes(), untypedBuffer()];
  list.push(untypedBuffer());
  const map = new Map<string, BytesLike>();
  map.set("k", untypedBuffer());
  console.log("Buffer", probeBuffer(annotated), probeBuffer(untypedBuffer()), probeBuffer(new HolderBuffer(untypedBuffer()).held), list.map(probeBuffer).join(), probeBuffer(throughBuffer()), probeBuffer(untypedBuffer() as BytesLike), probeBuffer(map.get("k")!));
}
function probeBunfile(x: BlobLike): string { return typeof x.size + x.type; }
class HolderBunfile { held: BlobLike; constructor(held: BlobLike) { this.held = held; } }
function untypedBunfile(): any { return Bun.file("/nowhere/at-all.txt"); }
function throughBunfile(): BlobLike { return untypedBunfile(); }
{
  const annotated: BlobLike = untypedBunfile();
  const list: BlobLike[] = [new FakeBlob(), untypedBunfile()];
  list.push(untypedBunfile());
  const map = new Map<string, BlobLike>();
  map.set("k", untypedBunfile());
  console.log("Bun.file", probeBunfile(annotated), probeBunfile(untypedBunfile()), probeBunfile(new HolderBunfile(untypedBunfile()).held), list.map(probeBunfile).join(), probeBunfile(throughBunfile()), probeBunfile(untypedBunfile() as BlobLike), probeBunfile(map.get("k")!));
}
function probeTimer(x: TimerLike): string { return String(x.unref().hasRef()); }
class HolderTimer { held: TimerLike; constructor(held: TimerLike) { this.held = held; } }
function untypedTimer(): any { return setTimeout(() => {}, 0); }
function throughTimer(): TimerLike { return untypedTimer(); }
{
  const annotated: TimerLike = untypedTimer();
  const list: TimerLike[] = [new FakeTimer(), untypedTimer()];
  list.push(untypedTimer());
  const map = new Map<string, TimerLike>();
  map.set("k", untypedTimer());
  console.log("Timer", probeTimer(annotated), probeTimer(untypedTimer()), probeTimer(new HolderTimer(untypedTimer()).held), list.map(probeTimer).join(), probeTimer(throughTimer()), probeTimer(untypedTimer() as TimerLike), probeTimer(map.get("k")!));
}
function probeStats(x: StatsLike): string { return typeof x.size + typeof x.mtime.getTime() + x.isDirectory(); }
class HolderStats { held: StatsLike; constructor(held: StatsLike) { this.held = held; } }
function untypedStats(): any { return statSync("/"); }
function throughStats(): StatsLike { return untypedStats(); }
{
  const annotated: StatsLike = untypedStats();
  const list: StatsLike[] = [new FakeStats(), untypedStats()];
  list.push(untypedStats());
  const map = new Map<string, StatsLike>();
  map.set("k", untypedStats());
  console.log("Stats", probeStats(annotated), probeStats(untypedStats()), probeStats(new HolderStats(untypedStats()).held), list.map(probeStats).join(), probeStats(throughStats()), probeStats(untypedStats() as StatsLike), probeStats(map.get("k")!));
}
