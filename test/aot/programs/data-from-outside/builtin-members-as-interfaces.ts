// The same as host-members-as-interfaces.ts, with built-in classes only: a typed array, a map, a set, a regular expression, a promise. A built-in object is used through one of the program's interfaces, and each member is used through the interface's own member type. Each case has its own interfaces, and for each a program class with one extra member, so no built-in object matches those classes. The output must match plain Bun.

// a property of a typed array
interface RawBufferLike { byteLength: number }
interface ByteViewLike { length: number; buffer: RawBufferLike }
class FakeRawBuffer implements RawBufferLike { fakeOnly = 0; byteLength = -1; }
class FakeByteView implements ByteViewLike { fakeOnly = 0; length = -1; buffer: RawBufferLike = new FakeRawBuffer(); }
function showView(view: ByteViewLike) { return view.length + " " + view.buffer.byteLength; }
const view: ByteViewLike = new Uint8Array(4);
console.log(showView(view), showView(new FakeByteView()));

// a method's return value
interface WindowLike { length: number; byteOffset: number }
interface WindowSourceLike { length: number; subarray(begin?: number, end?: number): WindowLike }
class FakeWindow implements WindowLike { fakeOnly = 0; length = -1; byteOffset = -2; }
class FakeWindowSource implements WindowSourceLike { fakeOnly = 0; length = -1; subarray(): WindowLike { return new FakeWindow(); } }
function showWindow(source: WindowSourceLike) { const part = source.subarray(1, 3); return part.length + " " + part.byteOffset; }
console.log(showWindow(new Uint8Array(4)), showWindow(new FakeWindowSource()));

// what a map's `get` returns
interface StampLike { getTime(): number }
interface LookupLike { get(key: string): StampLike | undefined }
class FakeStamp implements StampLike { fakeOnly = 0; getTime() { return -1; } }
class FakeLookup implements LookupLike { fakeOnly = 0; get(key: string): StampLike | undefined { return key === "a" ? new FakeStamp() : undefined; } }
function showLookup(lookup: LookupLike) { return lookup.get("a")?.getTime() + " " + lookup.get("b")?.getTime(); }
const stamps = new Map<string, Date>([["a", new Date(5)]]);
console.log(showLookup(stamps), showLookup(new FakeLookup()));

// what `exec` returns
interface FoundLike { index: number; input: string }
interface MatcherLike { exec(text: string): FoundLike | null }
class FakeFound implements FoundLike { fakeOnly = 0; index = -1; input = "fake"; }
class FakeMatcher implements MatcherLike { fakeOnly = 0; exec(text: string): FoundLike | null { return text ? new FakeFound() : null; } }
function showMatch(matcher: MatcherLike) { const found = matcher.exec("xab"); return found ? found.index + " " + found.input : "none"; }
console.log(showMatch(/ab/), showMatch(new FakeMatcher()));

// a callback's parameter
interface MomentLike { getTime(): number }
interface VisitableLike { forEach(visit: (item: MomentLike) => void): void }
class FakeMoment implements MomentLike { fakeOnly = 0; getTime() { return -1; } }
class FakeVisitable implements VisitableLike { fakeOnly = 0; forEach(visit: (item: MomentLike) => void) { visit(new FakeMoment()); } }
function showVisits(visitable: VisitableLike) { let total = 0; visitable.forEach(item => { total += item.getTime(); }); return total; }
console.log(showVisits(new Set([new Date(2), new Date(3)])), showVisits(new FakeVisitable()));

// a promise's value
interface InstantLike { getTime(): number }
interface ClockLike { now(): Promise<InstantLike> }
class FakeInstant implements InstantLike { fakeOnly = 0; getTime() { return -1; } }
class FakeClock implements ClockLike { fakeOnly = 0; async now(): Promise<InstantLike> { return new FakeInstant(); } }
async function showClock(clock: ClockLike) { return (await clock.now()).getTime(); }
const clocks = new Map<string, () => Promise<Date>>([["now", async () => new Date(7)]]);
const realClock: ClockLike = { now: clocks.get("now")! };
console.log(await showClock(realClock), await showClock(new FakeClock()));
