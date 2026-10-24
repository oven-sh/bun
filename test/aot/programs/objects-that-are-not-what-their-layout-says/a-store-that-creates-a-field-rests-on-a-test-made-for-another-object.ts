// `a.symbol = s; a.locals = t; b.symbol = s`: the stores create optional fields, and each rests on the word of the classes that nothing above the node takes the store.
// One test may answer for all three. Whatever is put above the nodes, and whenever, each store does what it does in plain Bun.
const out: string[] = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const defineUnseen = new Function("object", "key", "descriptor", "Object.defineProperty(object, key, descriptor)" + suffix) as (object: object, key: string, descriptor: PropertyDescriptor) => void;
const removeUnseen = new Function("object", "key", "return delete object[key]" + suffix) as (object: object, key: string) => boolean;

interface Sym {
  id: number;
}
interface Tab {
  size: number;
}
interface Node {
  kind: number;
  pos: number;
  symbol?: Sym;
  locals?: Tab;
}
function NodeObject(this: Node, kind: number, pos: number) {
  this.kind = kind;
  this.pos = pos;
}
const NodeConstructor = NodeObject as unknown as new (kind: number, pos: number) => Node;

let between: (() => void) | undefined;

function inOneBlock(a: Node, b: Node, s: Sym, t: Tab): void {
  a.symbol = s;
  a.locals = t;
  b.symbol = s;
}
function inABlockBehind(a: Node, b: Node, s: Sym, t: Tab, flag: boolean): void {
  a.symbol = s;
  a.locals = t;
  if (flag) b.locals = t;
}
function withCodeInBetween(a: Node, b: Node, s: Sym, t: Tab): void {
  a.symbol = s;
  a.locals = t;
  if (between) between();
  b.symbol = s;
}
function setBoth(n: Node, s: Sym, t: Tab): void {
  n.symbol = s;
  n.locals = t;
}
function setSymbol(n: Node, s: Sym): void {
  n.symbol = s;
}
function throughFunctions(a: Node, b: Node, s: Sym, t: Tab): void {
  setBoth(a, s, t);
  setSymbol(b, s);
}

const s: Sym = hide({ id: 3 });
const t: Tab = hide({ size: 5 });
function describe(n: Node): string {
  return `${Object.keys(n).join()}:${n.symbol ? n.symbol.id : "-"}:${n.locals ? n.locals.size : "-"}`;
}
function round(label: string): void {
  const forms: [string, (a: Node, b: Node) => void][] = [
    ["inOneBlock", (a, b) => inOneBlock(a, b, s, t)],
    ["inABlockBehind", (a, b) => inABlockBehind(a, b, s, t, true)],
    ["withCodeInBetween", (a, b) => withCodeInBetween(a, b, s, t)],
    ["throughFunctions", (a, b) => throughFunctions(a, b, s, t)],
  ];
  for (const [name, form] of forms) {
    const a = hide(new NodeConstructor(1, 1));
    const b = hide(new NodeConstructor(2, 2));
    form(a, b);
    out.push(`${label} ${name} ${describe(a)} ${describe(b)}`);
  }
}

for (let i = 0; i < 3000; i++) {
  const a = new NodeConstructor(1, i);
  const b = new NodeConstructor(2, i);
  inOneBlock(a, b, s, t);
  inABlockBehind(new NodeConstructor(1, i), new NodeConstructor(2, i), s, t, (i & 1) === 0);
  withCodeInBetween(new NodeConstructor(1, i), new NodeConstructor(2, i), s, t);
  throughFunctions(new NodeConstructor(1, i), new NodeConstructor(2, i), s, t);
  if (i === 2999) out.push(`warm ${describe(a)} ${describe(b)}`);
}
round("untouched");

// A setter arrives above the nodes under the name that only the first object stores.
const prototype = NodeObject.prototype as object;
let taken = 0;
defineUnseen(prototype, "locals", { set() { taken++; }, get() { return undefined; }, configurable: true });
round("setter for locals");
out.push(`taken ${taken}`);
removeUnseen(prototype, "locals");
round("setter for locals gone");

// Under the name that both store.
defineUnseen(prototype, "symbol", { set() { taken += 10; }, get() { return undefined; }, configurable: true });
round("setter for symbol");
out.push(`taken ${taken}`);
removeUnseen(prototype, "symbol");

// It arrives between the stores of the first object and the store of the second.
between = () => {
  defineUnseen(prototype, "symbol", { set() { taken += 100; }, get() { return undefined; }, configurable: true });
};
round("setter arrives in between");
out.push(`taken ${taken}`);
between = undefined;
removeUnseen(prototype, "symbol");

// A value that cannot be written stands above the nodes.
defineUnseen(prototype, "symbol", { value: s, writable: false, configurable: true });
try {
  round("read-only above");
} catch (error) {
  out.push(`threw ${(error as Error).constructor.name}`);
}
removeUnseen(prototype, "symbol");

// Another prototype for the second object alone.
{
  const a = hide(new NodeConstructor(1, 1));
  const b = hide(new NodeConstructor(2, 2));
  Object.setPrototypeOf(b, { set symbol(value: Sym) { taken += 1000; } });
  inOneBlock(a, b, s, t);
  out.push(`other prototype ${describe(a)} ${describe(b)} taken ${taken}`);
}
round("at the end");
console.log(out.join("\n"));
