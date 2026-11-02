import { isDeepStrictEqual } from "node:util";
import { deepEqual, deepStrictEqual, notDeepEqual, notDeepStrictEqual } from "node:assert";
import { cases } from "./cases";
const ok = (f: () => void) => { try { f(); return "T"; } catch { return "f"; } };
const say = (b: boolean) => (b ? "T" : "f");
for (const [name, left, right] of cases) {
  const l = left(), r = right();
  console.log("ROW", name + ":", say(Bun.deepEquals(l, r)) + say(Bun.deepEquals(r, l)), say(Bun.deepEquals(l, r, true)) + say(Bun.deepEquals(r, l, true)), say(isDeepStrictEqual(l, r)) + say(isDeepStrictEqual(r, l)), ok(() => deepEqual(l, r)) + ok(() => deepEqual(r, l)), ok(() => deepStrictEqual(l, r)) + ok(() => deepStrictEqual(r, l)), ok(() => notDeepEqual(l, r)) + ok(() => notDeepStrictEqual(l, r)));
}
