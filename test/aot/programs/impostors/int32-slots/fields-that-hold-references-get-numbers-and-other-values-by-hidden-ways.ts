// The neighbors of the number fields: fields declared as an object, a string, an array, a function or an instance, each `| null`, whose visible stores are references and null, so that a narrow slot for a reference looks enough.
// Hidden stores put numbers of every kind, booleans, undefined, bigints, symbols and references of other types there. Whatever was stored must come back, in its place among the keys, also after collections,
// and typed code that reads the field meanwhile must do with the stranger what JavaScript does: find no such member, call what is callable, or throw a TypeError.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Node_ {
  count = 0;
  record: { tag: number } | null = null;
  text: string | null = null;
  list: number[] | null = null;
  run: (() => number) | null = null;
  next: Node_ | null = null;
  last = 0;
}
function fill(node: Node_, i: number, next: Node_ | null) {
  node.count = Math.abs(i | 0);
  node.record = { tag: i };
  node.text = "t" + i;
  node.list = [i];
  node.run = () => i;
  node.next = next;
}
function clear(node: Node_) {
  node.record = null;
  node.text = null;
  node.list = null;
  node.run = null;
  node.next = null;
}
function typedView(node: Node_) {
  return `${node.record?.tag} ${node.text} ${node.list?.length} ${node.run?.()} ${node.next?.count}`;
}
function attempt(node: Node_) {
  try {
    return typedView(node);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function fresh() {
  const node = new Node_();
  handOver(node);
  return node;
}
function shown(value: unknown): string {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return value instanceof Node_ ? "node" : JSON.stringify(value);
  return exact(value);
}
let length = 0;
for (let i = 0; i < 2000; i++) {
  const node = fresh();
  fill(node, i & 31, i & 1 ? fresh() : null);
  length += typedView(node).length;
  if (i & 2) clear(node);
  length += typedView(node).length;
}
console.log("warm", length);
const names: string[] = JSON.parse('["record","text","list","run","next"]');
const strangers: unknown[] = [...odd.slice(0, 9), 1, 0, true, false, undefined, 10n, Symbol.for("s"), "a string", { other: 1 }, [1, 2], () => 2, new Map(), new Date(0)];
const kept: [Node_, string, unknown][] = [];
for (const name of names) {
  const lines: string[] = [];
  for (const value of strangers) {
    const empty = fresh(), filled = fresh();
    fill(filled, 5, null);
    (empty as any)[name] = value;
    Reflect.set(filled, name, value);
    kept.push([empty, name, value], [filled, name, value]);
    lines.push(`${shown(value)} ${Object.is((empty as any)[name], value)}${Object.is((filled as any)[name], value)} ${Object.keys(filled).join("") === "countrecordtextlistrunnextlast"} (${attempt(empty)}) (${attempt(filled)})`);
  }
  console.log(name + ":", lines.join(" | "));
}
Bun.gc(true);
let junk = 0;
for (let i = 0; i < 1_000_000; i++) junk += [{ tag: i }, "j" + (i & 255)].length;
Bun.gc(true);
console.log("after collections:", junk, kept.filter(([node, name, value]) => Object.is((node as any)[name], value)).length, "of", kept.length);
let restored = 0;
for (const [node] of kept) {
  fill(node, 7, null);
  if (typedView(node) === "7 t7 1 7 undefined") restored++;
}
console.log("filled by typed code again:", restored, JSON.stringify(kept[0][0]));
