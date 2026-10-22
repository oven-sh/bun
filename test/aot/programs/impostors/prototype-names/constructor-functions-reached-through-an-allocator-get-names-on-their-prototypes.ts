// Constructor functions with a typed `this`, called as `new (allocator.getSymbolConstructor())(..)`, as the TypeScript compiler makes its symbols and nodes.
// Fields that the constructor does not store are added later. Their names arrive on the prototype of the function, which no text names next to the change.
interface Sym {
  flags: number;
  escapedName: string;
  declarations?: string[];
  parent?: Sym;
  mergeId?: number;
}
interface Nod {
  kind: number;
  pos: number;
  end: number;
  symbol?: Sym;
  original?: Nod;
}
function Sym(this: Sym, flags: number, name: string) {
  this.flags = flags;
  this.escapedName = name;
}
function Nod(this: Nod, kind: number, pos: number, end: number) {
  this.kind = kind;
  this.pos = pos;
  this.end = end;
}
const allocator = {
  getSymbolConstructor: () => Sym as any as new (flags: number, name: string) => Sym,
  getNodeConstructor: () => Nod as any as new (kind: number, pos: number, end: number) => Nod,
};
const log: string[] = [];
function createSymbol(flags: number, name: string): Sym {
  return new (allocator.getSymbolConstructor())(flags, name);
}
function createNode(kind: number, pos: number, end: number): Nod {
  return new (allocator.getNodeConstructor())(kind, pos, end);
}
function addDeclaration(symbol: Sym, text: string) {
  if (!symbol.declarations) symbol.declarations = [text];
  else symbol.declarations.push(text);
}
function mergeIdOf(symbol: Sym) {
  return symbol.mergeId || (symbol.mergeId = symbol.flags + 100);
}
function bind(node: Nod, symbol: Sym) {
  node.symbol = symbol;
  symbol.parent ??= symbol;
}
function originalOf(node: Nod): Nod {
  while (node.original) node = node.original;
  return node;
}
function showSymbol(symbol: Sym) {
  return `${symbol.declarations} ${symbol.mergeId} ${symbol.parent?.escapedName} [${Object.keys(symbol)}]`;
}
function showNode(node: Nod) {
  return `${node.symbol?.escapedName} ${originalOf(node).kind} [${Object.keys(node)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const symbol = createSymbol(i & 15, "s" + (i & 3));
  const node = createNode(i & 7, i, i + 1);
  if (i & 1) addDeclaration(symbol, "d");
  if (i & 2) bind(node, symbol);
  if (i & 4) node.original = createNode(9, 0, 0);
  sum += mergeIdOf(symbol) + originalOf(node).kind + (symbol.declarations?.length ?? 0) + (node.symbol ? 1 : 0);
}
console.log("warm", sum);

const oldSymbol = createSymbol(1, "old");
const oldNode = createNode(1, 0, 1);
const shared = ["shared"];
const holders = [oldSymbol, oldNode].map(Object.getPrototypeOf);
holders[0]["declarations"] = shared;
holders[0]["merge" + "Id"] = 55;
Object.defineProperty(holders[1], "symbol", {
  get() {
    return undefined;
  },
  set(this: Nod, value: Sym) {
    log.push(`symbol ${value.escapedName} on node ${this.kind}`);
  },
  configurable: true,
});
holders[1].original = undefined;
const newSymbol = createSymbol(2, "new");
const newNode = createNode(2, 0, 1);
console.log("inherited:", showSymbol(oldSymbol), "|", showSymbol(newSymbol), "|", showNode(oldNode), "|", showNode(newNode));
addDeclaration(oldSymbol, "pushed onto the shared list");
addDeclaration(newSymbol, "this too");
console.log("merge ids:", mergeIdOf(oldSymbol), mergeIdOf(newSymbol));
bind(oldNode, oldSymbol);
bind(newNode, newSymbol);
console.log("after:", showSymbol(oldSymbol), "|", showSymbol(newSymbol), "|", showNode(oldNode), "|", showNode(newNode));
console.log(shared.join("; "), "|", log.join(", "));
for (const holder of holders) for (const name of Object.keys(Object.getOwnPropertyDescriptors(holder))) if (name !== "constructor") delete holder[name];
addDeclaration(oldSymbol, "own");
bind(oldNode, oldSymbol);
console.log("gone again:", showSymbol(oldSymbol), mergeIdOf(oldSymbol), "|", showNode(oldNode), "|", showSymbol(createSymbol(3, "last")), log.length);
