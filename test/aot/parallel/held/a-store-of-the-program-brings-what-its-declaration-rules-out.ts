// COUNTER: FieldsEvictedByTypeMismatch >= 50
// The stores of the program itself lie: what a parameter, a variable or a result is declared as is not what arrives. Each store, each literal and each constructor is entered with what is declared
// many times, and then with every other kind of value. What is read back, by name, by key and by a list of the keys, is what was stored.

interface Pair {
  left: number;
  right: string;
  child: Pair | undefined;
}

class Cell {
  count: number;
  tag: string;
  flag: boolean;
  inner: Cell | undefined;
  items: string[];
  run: () => number;
  constructor(count: number, tag: string, flag: boolean, inner: Cell | undefined, items: string[], run: () => number) {
    this.count = count;
    this.tag = tag;
    this.flag = flag;
    this.inner = inner;
    this.items = items;
    this.run = run;
  }
}

class WithInitializers {
  count: number = seedOfCount();
  tag: string = seedOfTag();
  inner: Cell | undefined = seedOfInner();
}

function OldStyle(this: any, kind: number, name: string, parent: any) {
  this.kind = kind;
  this.name = name;
  this.parent = parent;
  this.id = 0;
}

let lie: unknown = undefined;
let lies = false;
function seedOfCount(): number {
  return lies ? (lie as number) : 1;
}
function seedOfTag(): string {
  return lies ? (lie as string) : "tag";
}
function seedOfInner(): Cell | undefined {
  return lies ? (lie as Cell) : undefined;
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (Object.is(value, -0)) return "-0";
  if (value !== null && typeof value === "object") return Array.isArray(value) ? "array(" + value.length + ")" : "object";
  return String(value);
}
function attempt(read: () => unknown): string {
  try {
    return show(read());
  } catch (error) {
    return (error as Error).name;
  }
}
function describe(object: object): string {
  const parts: string[] = [];
  for (const key of Object.keys(object)) parts.push(key + "=" + show((object as any)[key]));
  return parts.join(",");
}

function makePair(left: number, right: string, child: Pair | undefined): Pair {
  return { left, right, child };
}
function makePairTheOtherWayRound(left: number, right: string, child: Pair | undefined): Pair {
  return { child, right, left };
}
function makeCell(count: number, tag: string, flag: boolean, inner: Cell | undefined, items: string[], run: () => number): Cell {
  return new Cell(count, tag, flag, inner, items, run);
}
function setAll(cell: Cell, count: number, tag: string, flag: boolean, inner: Cell | undefined, items: string[], run: () => number) {
  cell.count = count;
  cell.tag = tag;
  cell.flag = flag;
  cell.inner = inner;
  cell.items = items;
  cell.run = run;
}
function copyOver(to: Cell, from: Cell) {
  to.count = from.count;
  to.tag = from.tag;
  to.flag = from.flag;
  to.inner = from.inner;
  to.items = from.items;
  to.run = from.run;
}
function spreadOf(pair: Pair, left: number): Pair {
  return { ...pair, left };
}
function readPair(pair: Pair): string {
  return [attempt(() => pair.left + 1), attempt(() => pair.right.length), attempt(() => pair.child!.left), attempt(() => pair.child!.right.length)].join(" ");
}
function readCell(cell: Cell): string {
  return [
    attempt(() => cell.count | 0),
    attempt(() => cell.count + 0.5),
    attempt(() => cell.tag.length),
    attempt(() => cell.tag + "!"),
    attempt(() => (cell.flag ? 1 : 2)),
    attempt(() => cell.inner!.count),
    attempt(() => cell.inner!.tag.length),
    attempt(() => cell.items.length),
    attempt(() => cell.items[0].length),
    attempt(() => cell.run()),
  ].join(" ");
}

const honestCell = () => makeCell(1, "one", true, undefined, ["a"], () => 1);
let warm = "";
for (let turn = 0; turn < 60; turn++) {
  const inner = makeCell(turn, "inner", false, undefined, ["x", "y"], () => turn);
  const cell = makeCell(turn, "cell" + turn, turn % 2 === 0, inner, ["p"], () => turn * 2);
  setAll(cell, turn + 1, "set", true, inner, ["q", "r"], () => 5);
  copyOver(honestCell(), cell);
  const pair = makePair(turn, "right", makePairTheOtherWayRound(turn, "child", undefined));
  warm = readCell(cell) + " / " + readPair(spreadOf(pair, 9)) + " / " + describe(new WithInitializers()) + " / " + describe(new (OldStyle as any)(turn, "old", undefined));
}
console.log("honest", warm);

const strangers: unknown[] = [
  undefined, null, true, false, 0, -0, 7, 2.5, NaN, Infinity, 2 ** 31, 2 ** 53, -(2 ** 31) - 1, "text", "", 10n, Symbol.iterator, [1, 2, 3], ["s"], {}, { count: "c", tag: 5 },
  () => "called", new Map(), honestCell(), makePair(1, "p", undefined), new Date(0), Object.create(null), new Proxy({}, {}),
];

for (const stranger of strangers) {
  const s = stranger as any;
  const lines: string[] = [];
  for (let position = 0; position < 6; position++) {
    const honest: any[] = [1, "one", true, honestCell(), ["a"], () => 1];
    honest[position] = s;
    const made = makeCell(honest[0], honest[1], honest[2], honest[3], honest[4], honest[5]);
    lines.push(readCell(made) + " {" + describe(made) + "}");
    const set = honestCell();
    setAll(set, honest[0], honest[1], honest[2], honest[3], honest[4], honest[5]);
    lines.push(readCell(set) + " {" + describe(set) + "}");
    const copied = honestCell();
    copyOver(copied, made);
    lines.push(readCell(copied) + " {" + describe(copied) + "}");
    // And an honest value again: the field is what it was declared as once more.
    setAll(set, 2, "two", false, undefined, ["b"], () => 2);
    lines.push(readCell(set) + " {" + describe(set) + "}");
  }
  for (let position = 0; position < 3; position++) {
    const honest: any[] = [1, "right", makePair(2, "child", undefined)];
    honest[position] = s;
    const pair = makePair(honest[0], honest[1], honest[2]);
    const other = makePairTheOtherWayRound(honest[0], honest[1], honest[2]);
    lines.push(readPair(pair) + " {" + describe(pair) + "}", readPair(other) + " {" + describe(other) + "}", readPair(spreadOf(pair, s)) + " {" + describe(spreadOf(pair, s)) + "}");
  }
  lie = stranger;
  lies = true;
  lines.push(describe(new WithInitializers()));
  lies = false;
  lines.push(describe(new (OldStyle as any)(s, "old", undefined)), describe(new (OldStyle as any)(1, s, undefined)), describe(new (OldStyle as any)(1, "old", s)));
  console.log(show(stranger), lines.join(" | "));
}
