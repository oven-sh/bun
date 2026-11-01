// assert.deepStrictEqual(): the first value, an instance, has a hidden `constructor` of its own, so the prototypes are compared.
import assert from "node:assert";
class Other {}
class Box { constructor(a) { this.a = a; } }
const first = new Box(1);
Object.defineProperty(first, "constructor", { value: Other, enumerable: false });
let r; try { assert.deepStrictEqual(first, new Box(1)); r = "equal"; } catch { r = "throws"; }
console.log(r);
