// The parser and the validator that the compiler emits for a recursive type are functions of their own: chains of early returns with double constants between them. Text takes the parser; what a reviver returns, and what the parser refuses, takes the validator.
import type { Schema } from "bun";
interface Tree {
  a: number & Schema.Min<1.5> & Schema.Max<99.5>;
  b: number & Schema.Min<2.5> & Schema.Max<98.5>;
  c: number & Schema.Min<3.5> & Schema.Max<97.5>;
  d: number & Schema.Min<4.5> & Schema.Max<96.5>;
  e: number & Schema.Min<5.5> & Schema.Max<95.5>;
  f: number & Schema.Min<6.5> & Schema.Max<94.5>;
  g: number;
  h: number;
  i: number;
  j: number;
  k: string;
  l: string;
  children: Tree[];
}
function make(depth: number, change?: (tree: Record<string, unknown>) => void): unknown {
  const tree: Record<string, unknown> = { a: 10.5, b: 11.5, c: 12.5, d: 13.5, e: 14.5, f: 15.5, g: 1, h: 2, i: 3, j: 4, k: "k", l: "l", children: depth ? [make(depth - 1), make(depth - 1, change)] : [] };
  if (!depth && change) change(tree);
  return tree;
}
const lines: string[] = [];
function accepts(parse: () => Tree): boolean {
  try {
    parse();
    return true;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return false;
  }
}
const roads: ((value: unknown) => Tree)[] = [
  value => JSON.parse<Tree>(JSON.stringify(value)),
  value => JSON.parse<Tree>(JSON.stringify(value, null, 2)),
  value => JSON.parse<Tree>(JSON.stringify(value), (_, held) => held),
];
function show(label: string, value: unknown): void {
  const [compact, indented, revived] = roads.map(road => accepts(() => road(value)));
  lines.push(label + ": " + compact + (indented === compact && revived === compact ? "" : ", indented: " + indented + ", revived: " + revived));
}
show("as it should be", make(3));
for (const name of ["a", "b", "c", "d", "e", "f"]) {
  show(name + " too small", make(2, tree => { tree[name] = 0.5; }));
  show(name + " too great", make(2, tree => { tree[name] = 99.75; }));
  show(name + " at its least", make(2, tree => { tree[name] = 1.5 + "abcdef".indexOf(name); }));
  show(name + " at its most", make(2, tree => { tree[name] = 99.5 - "abcdef".indexOf(name); }));
  show(name + " a string", make(2, tree => { tree[name] = "10.5"; }));
  show(name + " missing", make(2, tree => { delete tree[name]; }));
}
for (const name of ["g", "h", "i", "j"]) {
  show(name + " null", make(1, tree => { tree[name] = null; }));
  show(name + " negative", make(1, tree => { tree[name] = -1e300; }));
}
show("k a number", make(1, tree => { tree.k = 1; }));
show("children no array", make(1, tree => { tree.children = {}; }));
show("a child that is no tree", make(1, tree => { tree.children = [7]; }));
show("no object", 7);
show("null", null);
let accepted = 0;
const tree = make(3);
for (let round = 0; round < 2000; round++) accepted += +accepts(() => roads[round % 3](tree));
lines.push("accepted " + accepted);
console.log(lines.join("\n"));
