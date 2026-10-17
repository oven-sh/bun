// A validator that the compiler emits for a recursive type is a function of its own: a chain of early returns with reads by name and double constants between them.
import type { Max, Min } from "bun";
interface Tree {
  a: number & Min<1.5> & Max<99.5>;
  b: number & Min<2.5> & Max<98.5>;
  c: number & Min<3.5> & Max<97.5>;
  d: number & Min<4.5> & Max<96.5>;
  e: number & Min<5.5> & Max<95.5>;
  f: number & Min<6.5> & Max<94.5>;
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
function show(label: string, value: unknown): void {
  lines.push(label + ": " + Bun.safeValidate<Tree>(JSON.parse(JSON.stringify(value))).success);
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
const tree = JSON.parse(JSON.stringify(make(3)));
for (let round = 0; round < 2000; round++) accepted += +Bun.safeValidate<Tree>(tree).success;
lines.push("accepted " + accepted);
console.log(lines.join("\n"));
