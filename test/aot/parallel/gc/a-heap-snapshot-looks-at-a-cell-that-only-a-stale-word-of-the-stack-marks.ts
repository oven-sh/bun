// A literal is lent to a call and its life ends behind the call. The body of the module runs on, and a word of its stack may still name the cell: the collector marks it, and nobody reads it.
// A V8 heap snapshot asks every marked cell whether it can be called. Where proofs are checked the cell is overwritten at the end of its life and stops whoever uses it: that look is no use.
// Under: --aot-testing=CheckProofsAtRunTime: the snapshot goes by the overwritten cell
import { isDeepStrictEqual } from "node:util";

const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

interface Kit {
  label: string;
  first: () => number;
  maybe: (() => string) | undefined | null;
  own: () => string;
}
let calls = 0;
function kit(label: string): Kit {
  const made = {
    label,
    first: () => ++calls,
    maybe: () => label + " maybe",
  } as Kit;
  made.own = () => made.label + " owns";
  return made;
}
function without(label: string, nothing: undefined | null): Kit {
  const made = kit(label);
  made.maybe = nothing;
  return made;
}
// What a reader saw must be what a read gives afterwards, and the functions still capture their own object.
function stillWhole(made: Kit) {
  const own = made.own;
  const maybe = made.maybe;
  return [own === made.own, own(), maybe === made.maybe, maybe ? maybe() : String(maybe), typeof made.first].join(" ");
}
// Deep equality.
const compared = kit("d");
say("deep", isDeepStrictEqual(compared, compared), isDeepStrictEqual(kit("d"), kit("d")), Bun.deepEquals(compared, compared), Bun.deepEquals(kit("d"), kit("d")));
say("deep with nothing", isDeepStrictEqual(without("d", null), without("d", undefined)), Bun.deepEquals(without("d", null), without("d", null), true));
const comparedWithCopy = kit("e");
say("deep with copy", isDeepStrictEqual(comparedWithCopy, { ...comparedWithCopy }), Bun.deepEquals(comparedWithCopy, { ...comparedWithCopy }, true), stillWhole(comparedWithCopy));
// The collector and the heap snapshots.
const collected: Kit[] = [];
for (let i = 0; i < 200; i++) collected.push(i % 3 === 0 ? kit("k" + i) : without("k" + i, i % 3 === 1 ? null : undefined));
Bun.gc(true);
say("snapshots", typeof Bun.generateHeapSnapshot(), typeof Bun.generateHeapSnapshot("v8"));
Bun.gc(true);
console.log(lines.join("\n"));
