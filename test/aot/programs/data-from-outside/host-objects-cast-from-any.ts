// A host object typed `any` or `unknown` is cast with `as`, or annotated, as one of the program's interfaces. Its members and what its methods return, directly or through a promise, are then used through the interface's own member types. Each case has its own interfaces, and for each a program class with one extra member, so no host object matches those classes. The output must match plain Bun.

// a method's return value, cast from `any`
interface BytesLike { length: number; byteLength: number }
interface EncoderLike { encoding: string; encode(text?: string): BytesLike }
class FakeBytes implements BytesLike { fakeOnly = 0; length = -1; byteLength = -2; }
class FakeEncoder implements EncoderLike { fakeOnly = 0; encoding = "fake"; encode(): BytesLike { return new FakeBytes(); } }
function showEncoder(encoder: EncoderLike) { const bytes = encoder.encode("abc"); return encoder.encoding + " " + bytes.length + " " + bytes.byteLength; }
function untypedEncoder(): any { return new TextEncoder(); }
console.log(showEncoder(untypedEncoder() as EncoderLike), showEncoder(new FakeEncoder()));

// a method that returns the same interface, cast from `unknown`
interface SliceLike { size: number; slice(start?: number, end?: number): SliceLike }
class FakeSlice implements SliceLike { fakeOnly = 0; size = -1; slice(): SliceLike { return this; } }
function showSlice(whole: SliceLike) { return whole.slice(1, 5).slice(1).size; }
function unknownBlob(): unknown { return new Blob(["abcdef"]); }
console.log(showSlice(unknownBlob() as SliceLike), showSlice(new FakeSlice()));

// a promise's value, cast from `any`
interface BufferLike { byteLength: number }
interface BufferSourceLike { arrayBuffer(): Promise<BufferLike> }
class FakeBuffer implements BufferLike { fakeOnly = 0; byteLength = -1; }
class FakeBufferSource implements BufferSourceLike { fakeOnly = 0; async arrayBuffer(): Promise<BufferLike> { return new FakeBuffer(); } }
async function showBuffer(source: BufferSourceLike) { return (await source.arrayBuffer()).byteLength; }
function untypedResponse(): any { return new Response("abcd"); }
console.log(await showBuffer(untypedResponse() as BufferSourceLike), await showBuffer(new FakeBufferSource()));

// a property, cast from `any`
interface QueryLike { get(name: string): string | null }
interface LinkLike { href: string; searchParams: QueryLike }
class FakeQuery implements QueryLike { fakeOnly = 0; get(name: string): string | null { return "fake-" + name; } }
class FakeLink implements LinkLike { fakeOnly = 0; href = "fake:"; searchParams: QueryLike = new FakeQuery(); }
function showLink(link: LinkLike) { return link.href + " " + link.searchParams.get("a"); }
function untypedUrl(): any { return new URL("http://h/p?a=1"); }
console.log(showLink(untypedUrl() as LinkLike), showLink(new FakeLink()));

// a promise's value, annotated from `any`
interface TextBlobLike { size: number }
interface TextBlobSourceLike { blob(): Promise<TextBlobLike> }
class FakeTextBlob implements TextBlobLike { fakeOnly = 0; size = -1; }
class FakeTextBlobSource implements TextBlobSourceLike { fakeOnly = 0; async blob(): Promise<TextBlobLike> { return new FakeTextBlob(); } }
async function showTextBlob(source: TextBlobSourceLike) { return (await source.blob()).size; }
function untypedRequest(): any { return new Request("http://h/", { method: "POST", body: "abcde" }); }
const annotatedSource: TextBlobSourceLike = untypedRequest();
console.log(await showTextBlob(annotatedSource), await showTextBlob(new FakeTextBlobSource()));
