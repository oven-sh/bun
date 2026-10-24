// Conversions of plain objects into unions whose arms could both take them: large trees, long lists, parts that are shared, cycles, accessors that throw in the middle, and accessors that start another validation or parse of the same types in the middle of the first.
import { validate } from "bun:bundle";
type Mixed = { below: Mixed | null; k: "one" } | { below: Mixed | null; k: 2 } | { below: Mixed | null; k: false } | { below: Mixed | null; k: null };
type Forked = { left: Forked | null; right: Forked | null; k: "one" } | { left: Forked | null; right: Forked | null; k: null };
type Listed = { items: Listed[]; k: "one" } | { items: Listed[]; k: null };
type Holder = { mixed: Mixed; forked: Forked; listed: Listed; more: (Mixed | Forked)[] };

function say(run: () => unknown): string {
  try {
    const value: any = run();
    let count = 0;
    const seen = new Set<unknown>();
    const stack = [value];
    while (stack.length && count < 200000) {
      const at = stack.pop();
      if (typeof at !== "object" || at === null || seen.has(at)) continue;
      seen.add(at);
      count++;
      for (const key of Object.keys(at)) stack.push(at[key]);
    }
    return "a value of " + count + " objects";
  } catch (error: any) {
    return error?.name === "TypeError" && error.issues?.length > 0 ? "refused" : "thrown: " + error?.name;
  }
}
const chain = (levels: number, k: unknown, bottom: unknown = null): any => {
  let value = bottom;
  for (let level = 0; level < levels; level++) value = { below: value, k };
  return value;
};
const fork = (levels: number, k: unknown): any => (levels === 0 ? null : { left: fork(levels - 1, k), right: fork(levels - 1, k), k });
const shared = (levels: number, k: unknown): any => {
  let value: any = null;
  for (let level = 0; level < levels; level++) value = { left: value, right: value, k };
  return value;
};
const listed = (width: number, levels: number, k: unknown): any => ({ items: levels ? Array.from({ length: width }, () => listed(width, levels - 1, k)) : [], k });

for (const k of [null, "one", 2, false]) for (const levels of [1, 10, 100, 1000]) console.log("a chain of " + levels + ", " + k + ": " + say(() => validate<Mixed>(chain(levels, k))));
for (const k of [null, "one"]) for (const levels of [2, 8, 14]) console.log("a full tree of " + levels + ", " + k + ": " + say(() => validate<Forked>(fork(levels, k))));
for (const k of [null, "one"]) for (const levels of [2, 10, 16]) console.log("shared parts, " + levels + " levels, " + k + ": " + say(() => validate<Forked>(shared(levels, k))));
for (const k of [null, "one"]) for (const [width, levels] of [[50000, 1], [200, 2], [30, 3]]) console.log("lists of " + width + ", " + levels + " levels, " + k + ": " + say(() => validate<Listed>(listed(width, levels, k))));
{
  const cycle: any = { below: null, k: null };
  cycle.below = { below: { below: cycle, k: null }, k: null };
  console.log("a cycle: " + say(() => validate<Mixed>(cycle)));
  const twin: any = { left: null, right: null, k: null };
  twin.left = twin;
  twin.right = twin;
  console.log("a cycle on both sides: " + say(() => validate<Forked>(twin)));
}
for (const levels of [1, 5, 50]) {
  for (const k of [null, "one"]) {
    console.log("an accessor that throws " + levels + " levels down, " + k + ": " + say(() => validate<Mixed>(chain(levels, k, { get below() { throw new RangeError("mine"); }, k }))));
    console.log("a misfit " + levels + " levels down, " + k + ": " + say(() => validate<Mixed>(chain(levels, k, { below: 7, k }))));
    console.log("an accessor that validates again " + levels + " levels down, " + k + ": " + say(() => validate<Mixed>(chain(levels, k, { get below() { validate<Mixed>(chain(30, k)); validate<Forked>(fork(6, null)); return null; }, k }))));
    console.log("an accessor that parses " + levels + " levels down, " + k + ": " + say(() => validate<Mixed>(chain(levels, k, { get below() { return JSON.parse<Mixed>('{"\\u0062elow":{"below":null,"k":null},"k":null}'); }, k }))));
    const root: any = chain(levels, k, { get below() { try { validate<Mixed>(root); } catch {} return null; }, k, turns: 0 });
    let turns = 0;
    const again: any = chain(levels, k, { get below() { if (turns++ < 3) validate<Mixed>(again); return null; }, k });
    console.log("an accessor that validates the same root " + levels + " levels down, " + k + ": " + say(() => validate<Mixed>(again)));
  }
}
console.log("together: " + say(() => validate<Holder>({ mixed: chain(40, null), forked: fork(8, null), listed: listed(20, 2, null), more: [chain(5, 2), fork(3, "one"), chain(5, null), fork(3, null)] })));
for (let round = 0; round < 200; round++) validate<Holder>({ mixed: chain(1 + (round % 9), null), forked: fork(1 + (round % 5), null), listed: listed(round % 4, 2, null), more: [] });
const text = JSON.stringify({ mixed: chain(40, null), forked: fork(8, null), listed: listed(20, 2, null), more: [chain(5, 2), fork(3, "one")] });
console.log("as text: " + say(() => JSON.parse<Holder>(text)) + "; with an escaped key: " + say(() => JSON.parse<Holder>(text.replace('"mixed"', '"\\u006dixed"'))));
