declare const console: any;
import { fill, fillBoth, state, either, reads, list, map, extra } from "./untyped.js";
import { makeDef, makeSlot, describe, sum, getState } from "./lib.ts";
function say(n: string, f: () => unknown): void { let r: string; try { r = JSON.stringify(f()) ?? "undefined"; } catch (e: any) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
const d = makeDef("d"), e = makeDef("e");
say("fill", () => describe(fill(d, "n"))); say("fill, null", () => describe(fill(null, null))); say("two", () => fillBoth(d, e).map(describe));
say("state", () => { const s = state(d, true); return [s.winner!.id, s.rule!.flag, s.count, s === getState()]; }); say("state again", () => state(e, false).count);
say("either", () => [describe(either(true, d)), describe(either(false, e))]); say("reads", () => reads());
say("list", () => sum(list(5))); say("map", () => [...map("k", 2)]); say("extra", () => extra(7));
function typedCaller(o: ReturnType<typeof makeDef>): string { const slot = makeSlot(); slot.owner = o; slot.name = "t"; return describe(slot); }
say("a typed caller", () => typedCaller(d));
let t = 0; for (let i = 0; i < 200000; i++) t += fill(i & 1 ? d : e, "x").owner!.id.length + state(d, true).count % 2;
console.log(t);
export {};
