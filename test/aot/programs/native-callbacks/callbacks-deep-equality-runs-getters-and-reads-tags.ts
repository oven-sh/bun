// Native bindings of the library: util.isDeepStrictEqual, assert.deepStrictEqual and Bun.deepEquals are native code that runs the own getters of both operands; each getter here belongs to one caller and sets its bit.
import { isDeepStrictEqual } from "node:util";
import { deepEqual, deepStrictEqual, notDeepStrictEqual } from "node:assert";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

const forUtil = { get a(): number { bits |= 1; return 1; } };
const forAssert = { get a(): number { bits |= 2; return 1; } };
const forLoose = { get a(): number { bits |= 4; return 1; } };
const forNot = { get a(): number { bits |= 8; return 1; } };
const forBun = { get a(): number { bits |= 16; return 1; } };
const forBunStrict = { get a(): number { bits |= 32; return 1; } };
const nested = { inner: [{ get a(): number { bits |= 64; return 1; } }] };
class Tagged { b = 1; get [Symbol.toStringTag](): string { bits |= 128; return "Tagged"; } }

const results = [isDeepStrictEqual(forUtil, { a: 1 }), Bun.deepEquals(forBun, { a: 1 }), Bun.deepEquals(forBunStrict, { a: 1 }, true), isDeepStrictEqual(nested, { inner: [{ a: 1 }] }), isDeepStrictEqual(new Tagged(), new Tagged())];
attempt(() => deepStrictEqual(forAssert, { a: 1 }));
attempt(() => deepEqual(forLoose, { a: "1" }));
attempt(() => notDeepStrictEqual(forNot, { a: 2 }));
console.log(bits.toString(2), results.join());
