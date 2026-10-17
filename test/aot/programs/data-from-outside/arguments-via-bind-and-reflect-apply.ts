// An object that satisfies a parameter's type is passed through `bind` or `Reflect.apply` instead of a direct call: a native object typed `any`, or a host object under its own type. Each case has its own interface and a program class for it, so no case affects another. The output must match plain Bun.

// `bind` with an argument typed `any`
interface StoreLike { clear(): void; size: number; onChange: ((e: any) => void) | null }
class FakeStore implements StoreLike { size = 1; onChange: ((e: any) => void) | null = null; clear() {} }
function storeSize(store: StoreLike): string { return typeof store.size; }
function makeStore(): any { const map: any = new Map(); map.onChange = null; return map; }
const boundStoreSize = storeSize.bind(null, makeStore());
console.log(boundStoreSize(), storeSize(new FakeStore()));

// `Reflect.apply` with an argument typed `any`
interface CacheLike { clear(): void; size: number; onEvict: ((e: any) => void) | null }
class FakeCache implements CacheLike { size = 1; onEvict: ((e: any) => void) | null = null; clear() {} }
function cacheSize(cache: CacheLike): string { return typeof cache.size; }
function makeCache(): any { const map: any = new Map(); map.onEvict = null; return map; }
console.log(Reflect.apply(cacheSize, null, [makeCache()]), cacheSize(new FakeCache()));

// `bind` with a host object under its own type
interface LocationLike { href: string; host: string }
class FakeLocation implements LocationLike { fakeOnly = 0; href = "fake:"; host = "fake"; }
function showLocation(location: LocationLike) { return location.href + " " + location.host; }
const boundShowLocation = showLocation.bind(null, new URL("http://h/p"));
console.log(boundShowLocation(), showLocation(new FakeLocation()));

// `Reflect.apply` with a host object under its own type
interface ReplyLike { status: number; ok: boolean }
class FakeReply implements ReplyLike { fakeOnly = 0; status = 1; ok = false; }
function showReply(reply: ReplyLike) { return reply.status + " " + reply.ok; }
console.log(Reflect.apply(showReply, null, [new Response("", { status: 201 })]), showReply(new FakeReply()));

// the second bound argument, on a method
interface ChunkLike { size: number; type: string }
class FakeChunk implements ChunkLike { fakeOnly = 0; size = -1; type = "fake"; }
class Uploader { prefix = "up"; send(label: string, chunk: ChunkLike) { return this.prefix + " " + label + " " + chunk.size + " " + typeof chunk.type; } }
const uploader = new Uploader();
function untypedChunk(): any { return new Blob(["abc"]); }
const sendChunk = uploader.send.bind(uploader, "a", untypedChunk());
console.log(sendChunk(), uploader.send("b", new FakeChunk()));
