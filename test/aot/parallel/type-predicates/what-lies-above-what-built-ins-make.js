// A built-in that is said to make "a typed array", "a Uint8Array" or "an error" makes an object of some class at or below the one that is named: each result is asked, out of a variable, for the prototype object of its own class and for those beside and above it.
const shared = Object.getPrototypeOf(Uint8Array.prototype);
const report = (label, above, own, ...others) => console.log(label, above === own, others.map(other => above === other).join(" "), above === shared, above === Object.prototype, above === null);

const bytes = new Uint8Array([1, 2, 3]), doubles = new Float64Array([1, 2, 3]), shorts = new Int16Array([1, 2, 3]), buffer = Buffer.from([1, 2, 3]);
const aboveFiltered = Object.getPrototypeOf(bytes.filter(() => true));
report("filter of bytes", aboveFiltered, Uint8Array.prototype, Buffer.prototype, Float64Array.prototype);
const aboveFilteredDoubles = Object.getPrototypeOf(doubles.filter(() => true));
report("filter of doubles", aboveFilteredDoubles, Float64Array.prototype, Uint8Array.prototype);
const aboveFilteredBuffer = Object.getPrototypeOf(buffer.filter(() => true));
report("filter of a buffer", aboveFilteredBuffer, Buffer.prototype, Uint8Array.prototype);
const aboveMapped = Object.getPrototypeOf(shorts.map(value => value));
report("map", aboveMapped, Int16Array.prototype, Uint8Array.prototype);
const aboveSliced = Object.getPrototypeOf(shorts.slice(1));
report("slice", aboveSliced, Int16Array.prototype, Uint8Array.prototype);
const aboveSlicedBuffer = Object.getPrototypeOf(buffer.slice(1));
report("slice of a buffer", aboveSlicedBuffer, Buffer.prototype, Uint8Array.prototype);
const aboveView = Object.getPrototypeOf(doubles.subarray(1));
report("subarray", aboveView, Float64Array.prototype, Uint8Array.prototype);
const aboveViewOfBuffer = Object.getPrototypeOf(buffer.subarray(1));
report("subarray of a buffer", aboveViewOfBuffer, Buffer.prototype, Uint8Array.prototype);
const aboveReversed = Object.getPrototypeOf(buffer.toReversed());
report("toReversed of a buffer", aboveReversed, Uint8Array.prototype, Buffer.prototype);
const aboveSorted = Object.getPrototypeOf(shorts.toSorted());
report("toSorted", aboveSorted, Int16Array.prototype, Uint8Array.prototype);
const aboveChanged = Object.getPrototypeOf(doubles.with(0, 5));
report("with", aboveChanged, Float64Array.prototype, Uint8Array.prototype);
const aboveFrom = Object.getPrototypeOf(Uint32Array.from([1, 2]));
report("from", aboveFrom, Uint32Array.prototype, Uint8Array.prototype);
const aboveOf = Object.getPrototypeOf(Float32Array.of(1, 2));
report("of", aboveOf, Float32Array.prototype, Uint8Array.prototype);

class Species extends Uint8Array { static get [Symbol.species]() { return Int8Array; } }
const aboveSpecies = Object.getPrototypeOf(new Species([1, 2]).filter(() => true));
report("filter by species", aboveSpecies, Int8Array.prototype, Uint8Array.prototype, Species.prototype);
class Own extends Uint8Array {}
const aboveOwn = Object.getPrototypeOf(new Own([1, 2]).filter(() => true));
report("filter below a class of the program", aboveOwn, Own.prototype, Uint8Array.prototype);
const changing = new Uint8Array([1, 2]);
const aboveChanging = Object.getPrototypeOf(changing.filter(() => { changing.constructor = Int32Array; return true; }));
report("filter whose callback changes the constructor", aboveChanging, Int32Array.prototype, Uint8Array.prototype);

const aboveEncoded = Object.getPrototypeOf(new TextEncoder().encode("text"));
report("encode", aboveEncoded, Uint8Array.prototype, Buffer.prototype);
const aboveHex = Object.getPrototypeOf(Uint8Array.fromHex("00ff"));
report("fromHex", aboveHex, Uint8Array.prototype, Buffer.prototype);
const aboveBase64 = Object.getPrototypeOf(Uint8Array.fromBase64("AAECAw=="));
report("fromBase64", aboveBase64, Uint8Array.prototype, Buffer.prototype);
const aboveBody = Object.getPrototypeOf(await new Response("text").bytes());
report("bytes of a response", aboveBody, Uint8Array.prototype, Buffer.prototype);
const aboveBlob = Object.getPrototypeOf(await new Blob(["text"]).bytes());
report("bytes of a blob", aboveBlob, Uint8Array.prototype, Buffer.prototype);

const caught = run => { try { run(); } catch (error) { return error; } };
const aboveTypeError = Object.getPrototypeOf(caught(() => null.x));
report("what a read of null throws", aboveTypeError, TypeError.prototype, Error.prototype, RangeError.prototype);
const aboveRangeError = Object.getPrototypeOf(caught(() => new Array(-1)));
report("what a length that is refused throws", aboveRangeError, RangeError.prototype, Error.prototype, TypeError.prototype);
const aboveSyntaxError = Object.getPrototypeOf(caught(() => JSON.parse("{")));
report("what JSON.parse throws", aboveSyntaxError, SyntaxError.prototype, Error.prototype);
const aboveMade = Object.getPrototypeOf(new Error("made"));
report("new Error", aboveMade, Error.prototype, TypeError.prototype);
const aboveCalled = Object.getPrototypeOf(RangeError("called"));
report("RangeError called", aboveCalled, RangeError.prototype, Error.prototype);
const aboveReason = Object.getPrototypeOf(await Promise.any([Promise.reject(1)]).catch(error => error));
report("what Promise.any rejects with", aboveReason, AggregateError.prototype, Error.prototype);

const aboveKeys = Object.getPrototypeOf([1].keys());
report("keys of a list", aboveKeys, Object.getPrototypeOf([][Symbol.iterator]()), Iterator.prototype);
const aboveHelper = Object.getPrototypeOf([1].values().map(value => value));
report("an iterator helper", aboveHelper, Object.getPrototypeOf(Iterator.from([]).map(value => value)), Iterator.prototype);
const aboveWrapped = Object.getPrototypeOf(Iterator.from({ next() { return { done: true }; } }));
report("Iterator.from", aboveWrapped, Object.getPrototypeOf(Iterator.from({ next() {} })), Iterator.prototype);
const aboveBound = Object.getPrototypeOf(function () {}.bind(null));
report("a bound function", aboveBound, Function.prototype);
const aboveBoundAsync = Object.getPrototypeOf(async function () {}.bind(null));
report("a bound async function", aboveBoundAsync, Object.getPrototypeOf(async function () {}), Function.prototype);
const aboveSignal = Object.getPrototypeOf(new AbortController().signal);
report("the signal of a controller", aboveSignal, AbortSignal.prototype, EventTarget.prototype);
const aboveTimeout = Object.getPrototypeOf(AbortSignal.abort());
report("AbortSignal.abort", aboveTimeout, AbortSignal.prototype, EventTarget.prototype);
const aboveMark = Object.getPrototypeOf(performance.mark("m"));
report("performance.mark", aboveMark, PerformanceMark.prototype, PerformanceEntry.prototype);
