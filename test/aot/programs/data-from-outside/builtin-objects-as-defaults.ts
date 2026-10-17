// A built-in object is the default value of a parameter, a pattern element or a parameter property whose type is one of the program's interfaces, and a member of it is used through the interface's own member type. Each case has its own interfaces, and for each a program class with one extra member, so no built-in object matches those classes. The output must match plain Bun.

// a parameter's default value
interface StorageLike { byteLength: number }
interface PixelsLike { length: number; buffer: StorageLike }
class FakeStorage implements StorageLike { fakeOnly = 0; byteLength = -1; }
class FakePixels implements PixelsLike { fakeOnly = 0; length = -1; buffer: StorageLike = new FakeStorage(); }
function makePixels(): Uint8Array { return new Uint8Array(4); }
function showPixels(pixels: PixelsLike = makePixels()) { return pixels.length + ":" + pixels.buffer.byteLength; }
console.log(showPixels(), showPixels(new FakePixels()));

// a default in an object pattern
interface MemoryLike { byteLength: number }
interface SamplesLike { length: number; buffer: MemoryLike }
class FakeMemory implements MemoryLike { fakeOnly = 0; byteLength = -1; }
class FakeSamples implements SamplesLike { fakeOnly = 0; length = -1; buffer: MemoryLike = new FakeMemory(); }
function makeSamples(): Float64Array { return new Float64Array(2); }
function showSamples({ samples = makeSamples() }: { samples?: SamplesLike }) { return samples.length + ":" + samples.buffer.byteLength; }
console.log(showSamples({}), showSamples({ samples: new FakeSamples() }));

// a default in an array pattern
interface BackingLike { byteLength: number }
interface WordsLike { length: number; buffer: BackingLike }
class FakeBacking implements BackingLike { fakeOnly = 0; byteLength = -1; }
class FakeWords implements WordsLike { fakeOnly = 0; length = -1; buffer: BackingLike = new FakeBacking(); }
function makeWords(): Uint16Array { return new Uint16Array(3); }
function showWords([words = makeWords()]: WordsLike[]) { return words.length + ":" + words.buffer.byteLength; }
console.log(showWords([]), showWords([new FakeWords()]));

// a parameter property's default value
interface RegionLike { byteLength: number }
interface CellsLike { length: number; buffer: RegionLike }
class FakeRegion implements RegionLike { fakeOnly = 0; byteLength = -1; }
class FakeCells implements CellsLike { fakeOnly = 0; length = -1; buffer: RegionLike = new FakeRegion(); }
function makeCells(): Int32Array { return new Int32Array(5); }
class Grid { constructor(public cells: CellsLike = makeCells()) {} show() { return this.cells.length + ":" + this.cells.buffer.byteLength; } }
console.log(new Grid().show(), new Grid(new FakeCells()).show());

// a default value whose method returns a built-in object
interface SpanLike { length: number; byteOffset: number }
interface TapeLike { length: number; subarray(begin?: number, end?: number): SpanLike }
class FakeSpan implements SpanLike { fakeOnly = 0; length = -1; byteOffset = -2; }
class FakeTape implements TapeLike { fakeOnly = 0; length = -1; subarray(): SpanLike { return new FakeSpan(); } }
function makeTape(): Uint8Array { return new Uint8Array(6); }
function showTape(tape: TapeLike = makeTape()) { const span = tape.subarray(2, 5); return span.length + ":" + span.byteOffset; }
console.log(showTape(), showTape(new FakeTape()));
