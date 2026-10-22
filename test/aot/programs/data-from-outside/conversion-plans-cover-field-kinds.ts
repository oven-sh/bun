declare const aotOperationCount: (name: string) => number;
// Objects built member by member in untyped code are read through record types whose fields are of every usual kind. Any object passes as the record. A member of the wrong kind throws where typed code reads it, undefined, null and a missing member pass, and the object stays as it was. Objects that fit do not enter the runtime's type check once per object.
type Leaf = { n: number; up: Leaf | null };
type Solid = { count: number; ratio: number; flag: boolean; label: string; leaf: Leaf; list: number[] };
type Loose = { maybeFlag?: boolean; maybeLabel: string | null; maybeLeaf: Leaf | null; act: (n: number) => number; thing: object; anything: unknown };

function typedLeaf(n: number): Leaf {
  return { n, up: null };
}
function typedSolid(): Solid {
  return { count: 1, ratio: 0.5, flag: true, label: "typed", leaf: typedLeaf(1), list: [1] };
}
function typedLoose(): Loose {
  return { maybeFlag: true, maybeLabel: null, maybeLeaf: null, act: n => n, thing: [], anything: 0 };
}
function showSolid(solid: Solid): string {
  return [solid.count, solid.ratio, solid.flag, solid.label, solid.leaf.n, solid.list.length].join();
}
function showLoose(loose: Loose): string {
  return [loose.maybeFlag, loose.maybeLabel, loose.maybeLeaf ? loose.maybeLeaf.n : "-", loose.act(2), typeof loose.thing, typeof loose.anything].join();
}
function growSolid(count: unknown, ratio: unknown, flag: unknown, label: unknown, leaf: unknown, list: unknown): any {
  const solid: any = { count };
  solid.ratio = ratio;
  solid.flag = flag;
  solid.label = label;
  solid.leaf = leaf;
  solid.list = list;
  return solid;
}
function growLoose(maybeFlag: unknown, maybeLabel: unknown, maybeLeaf: unknown, act: unknown, thing: unknown, anything: unknown): any {
  const loose: any = { maybeFlag };
  loose.maybeLabel = maybeLabel;
  loose.maybeLeaf = maybeLeaf;
  loose.act = act;
  loose.thing = thing;
  loose.anything = anything;
  return loose;
}
function attempt(made: any, show: (made: any) => string): void {
  const keys = Object.keys(made).join();
  const values = Object.values(made);
  let line: string;
  try {
    line = show(made);
  } catch (e) {
    line = e instanceof Error ? e.name : String(e);
  }
  const after = Object.values(made);
  console.log(line, Object.keys(made).join() === keys && after.length === values.length && after.every((value, i) => Object.is(value, values[i])) ? "same contents" : "CONTENTS CHANGED");
}

console.log(showSolid(typedSolid()), showLoose(typedLoose()));
const leaf = typedLeaf(7);
const list = [1, 2, 3];
const double = (n: number) => n * 2;
function triple(n: number): number {
  return n * 3;
}

let text = "";
const kept: unknown[] = [];
const before = aotOperationCount("operationAOTEnforceType");
for (let i = 0; i < 300; i++) {
  const solid = growSolid(i, i % 3 ? i + 0.5 : i, i % 2 === 0, "l" + (i % 5), leaf, list);
  const loose = growLoose(i % 2 === 0, i % 3 ? "m" : null, i % 4 ? leaf : null, i % 2 ? double : triple, i % 2 ? list : leaf, i % 5 ? i : leaf);
  kept.push(solid, loose);
  text = showSolid(solid) + " " + showLoose(loose);
}
const slow = aotOperationCount("operationAOTEnforceType") - before;
console.log(text, slow < 30 ? "without the runtime" : "through the runtime: " + slow);
console.log(JSON.stringify(kept[0]), JSON.stringify(kept[1]), JSON.stringify(kept[598]), JSON.stringify(kept[599]));

const solid = (change: (values: unknown[]) => void) => {
  const values: unknown[] = [1, 2.5, true, "l", leaf, list];
  change(values);
  attempt(growSolid(values[0], values[1], values[2], values[3], values[4], values[5]), showSolid);
};
const loose = (change: (values: unknown[]) => void) => {
  const values: unknown[] = [true, "m", leaf, double, list, 0];
  change(values);
  attempt(growLoose(values[0], values[1], values[2], values[3], values[4], values[5]), showLoose);
};
for (const odd of [undefined, null, true, 0, -0, 1.5, NaN, 2 ** 31, -(2 ** 30) - 1, "text", "", 10n, Symbol.iterator, leaf, list, double, triple, Math.abs, {}, Object.create(null), new Date(0), typedSolid()]) {
  for (let field = 0; field < 6; field++) {
    solid(values => { values[field] = odd; });
    loose(values => { values[field] = odd; });
  }
}
