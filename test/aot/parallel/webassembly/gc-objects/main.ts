// Structs, arrays and small integers of the garbage collected heap: made, read, written, tested, cast, handed to JavaScript and back, and null where an object is asked for.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}
async function moduleAt(path: string) {
  return new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

const e = new WebAssembly.Instance(await moduleAt(path)).exports as any;
const point = e.makePoint(3, 0.25);
const point3 = e.makePoint3(4, 0.5, 1n << 33n);
const leaf = e.makeLeaf(point);
console.log("read", e.x(point), e.y(point), e.x(point3), e.y(point3), e.z(point3), e.x(leaf));
e.setX(point, -7);
console.log("written", e.x(point));
console.log("null", outcomeOf(() => e.x(null)), outcomeOf(() => e.setX(null, 1)), outcomeOf(() => e.z(null)), outcomeOf(() => e.intAt(null, 0)));
console.log("cast", outcomeOf(() => e.z(point)), outcomeOf(() => e.z(leaf)));
console.log("kind", [null, 5, leaf, point3, point, e.makeInts(2), "text", 1.5, {}].map(value => e.kind(value)).join());
console.log("onCast", e.onCast(point3), e.onCast(point), e.onCast(null), e.onCast(3));
console.log("small", e.small(5), e.small(-1), e.small(1073741823), e.small(1073741824));
console.log("sumOfSquares", e.sumOfSquares(0), e.sumOfSquares(1), e.sumOfSquares(10), e.sumOfSquares(1000), e.sumOfSquares(100000));
const ints = e.makeInts(3);
console.log("intAt", e.intAt(ints, 2), outcomeOf(() => e.intAt(ints, 3)), outcomeOf(() => e.intAt(ints, -1)));
console.log("byteAt", e.byteAt(0), e.byteAt(11), outcomeOf(() => e.byteAt(12)));
console.log("shortAt", e.shortAt(0), e.shortAt(4), outcomeOf(() => e.shortAt(5)));
console.log("intFromText", e.intFromText(0), e.intFromText(2), outcomeOf(() => e.intFromText(3)));
console.log("byteAfterInit", [0, 1, 2, 3, 4, 5, 6, 7].map(i => e.byteAfterInit(i)).join());
console.log("filledAndCopied", [0, 1, 2, 3, 4, 5, 6, 7].map(i => e.filledAndCopied(i)).join());
console.log("chain", e.chain(0), e.chain(1), e.chain(300000), e.chain(300000));
console.log("wideChain", e.wideChain(0), e.wideChain(1), e.wideChain(200000), e.wideChain(200000));
// Objects of the module in the hands of JavaScript: nothing of theirs can be read, written or listed.
for (const opaque of [e.makeIntsOf(-1, 4), e.makeIntsOf(-1, 0), point3, leaf]) {
  console.log(
    "opaque",
    typeof opaque,
    opaque.length,
    opaque[0],
    "x" in opaque,
    Object.getPrototypeOf(opaque),
    Object.keys(opaque).length,
    outcomeOf(() => (opaque.x = 1)),
    outcomeOf(() => String(opaque)),
  );
}
const object = {};
console.log("roundTrip", e.roundTrip(object) === object, e.roundTrip(null), e.roundTrip(1.5), e.roundTrip(7), e.roundTrip("text"));
