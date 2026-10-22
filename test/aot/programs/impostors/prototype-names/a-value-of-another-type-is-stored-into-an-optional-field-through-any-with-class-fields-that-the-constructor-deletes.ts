// `(object as any).count = "many"`: a string goes into a field declared `count?: number`, an object into `name?: string`, a number into `child?: Node`, into empty slots and into filled ones.
// Everything that looks at the object without the type must see exactly what was stored, in the order it was stored; a value of the right type stored afterwards must be seen by typed code again.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Node_ {
  declare id: number;
  count?: number;
  name?: string;
  child?: Node_;
  flag?: boolean;
  constructor(id: number) {
    delete this.count;
    delete this.name;
    delete this.child;
    delete this.flag;
    handOver(this);
    this.id = id;
  }
}
function setCount(node: Node_, value: number) {
  node.count = value;
}
function setName(node: Node_, value: string) {
  node.name = value;
}
function countOf(node: Node_) {
  return node.count;
}
function nameOf(node: Node_) {
  return node.name;
}
function untyped(node: any) {
  const child = node.child;
  return `${typeof node.count}:${String(node.count)} ${typeof node.name}:${JSON.stringify(node.name)} ${typeof child}:${child && child.id} ${typeof node.flag}:${String(node.flag)}`;
}
function listing(node: Node_) {
  const names: string[] = [];
  for (const name in node) names.push(name);
  return `[${Object.keys(node)}] ${names.join() === Object.keys(node).join()} ${JSON.stringify(node)}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const node = new Node_(i);
  sum += countOf(node) ?? 1;
  if (i & 1) setCount(node, 2);
  if (i & 2) setName(node, "ab");
  sum += (countOf(node) ?? 1) + (nameOf(node)?.length ?? 0);
}
console.log("warm", sum);

const empty = new Node_(1);
(empty as any).name = { not: "a string" };
(empty as any).count = "many";
(empty as any).child = 42;
(empty as any).flag = null;
console.log("into empty slots:", untyped(empty), listing(empty));
console.log("own:", ["count", "name", "child", "flag"].map(name => Object.hasOwn(empty, name) + " " + (name in empty)).join(", "), JSON.stringify(Object.getOwnPropertyDescriptor(empty, "count")));

const filled = new Node_(2);
setCount(filled, 5);
setName(filled, "five");
filled.child = new Node_(3);
filled.flag = true;
console.log("filled:", untyped(filled), listing(filled));
(filled as any).count = "many";
(filled as any).name = 7;
(filled as any).child = "no node";
(filled as any).flag = 0;
console.log("over filled slots:", untyped(filled), listing(filled));

setCount(empty, 8);
setName(empty, "eight");
setCount(filled, 9);
setName(filled, "nine");
console.log("the right types again:", countOf(empty), nameOf(empty), countOf(filled), nameOf(filled), "|", untyped(empty), listing(empty), "|", listing(filled));

const odd = new Node_(4);
for (const value of ["text", 1.5, -0, NaN, 2 ** 31, 2 ** 53, 10n, Symbol.for("s"), null, undefined, true, [], () => 1]) {
  (odd as any).count = value;
  const back = (odd as any).count;
  console.log("  count =", typeof value, String(typeof value === "symbol" ? value.toString() : value), "->", Object.is(back, value), Object.keys(odd).join());
}
delete odd.count;
console.log("deleted:", (odd as any).count, "count" in odd, listing(odd));
setCount(odd, 3);
console.log("stored by typed code:", countOf(odd), listing(odd));
