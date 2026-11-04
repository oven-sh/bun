// COUNTER: FieldsLeftSlotByStoreOfOtherType >= 1000
// Each field is declared with one type, and every honest store brings it. Then a store of another type comes by each way that compiled code and other code have,
// between two reads of one function, in a loop, in a callee and in a getter that runs in the middle of a row of reads. What is read behind it is what the store has left.
import vm from "node:vm";

class Leaf {
  weight: number;
  name: string;
  constructor(weight: number, name: string) {
    this.weight = weight;
    this.name = name;
  }
  twice(): number {
    return this.weight * 2;
  }
}

class Branch {
  leaf: Leaf;
  next: Branch | undefined;
  kind: number;
  ratio: number;
  label: string;
  open: boolean;
  list: number[];
  act: (by: number) => number;
  constructor(seed: number, next: Branch | undefined) {
    this.leaf = new Leaf(seed, "leaf" + seed);
    this.next = next;
    this.kind = seed | 0;
    this.ratio = seed + 0.25;
    this.label = "branch" + seed;
    this.open = seed % 2 === 0;
    this.list = [seed, seed + 1];
    this.act = by => seed + by;
  }
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

// The readers. Each leans on the type of what it finds in a slot.
function weightOf(branch: Branch): unknown {
  return branch.leaf.weight;
}
function twiceOf(branch: Branch): unknown {
  return branch.leaf.twice();
}
function lengthOfName(branch: Branch): unknown {
  return branch.leaf.name.length;
}
function weightOfNext(branch: Branch): unknown {
  return branch.next!.leaf.weight;
}
function bitsOf(branch: Branch): unknown {
  return (branch.kind & 6) | (branch.kind << 1);
}
function halfOf(branch: Branch): unknown {
  return branch.ratio / 2;
}
function firstLetter(branch: Branch): unknown {
  return branch.label.charCodeAt(0) + branch.label.length;
}
function whetherOpen(branch: Branch): unknown {
  return branch.open ? "open" : "shut";
}
function secondOfList(branch: Branch): unknown {
  return branch.list[1] + branch.list.length;
}
function acted(branch: Branch): unknown {
  return branch.act(3);
}
const readers: [string, (branch: Branch) => unknown][] = [
  ["weightOf", weightOf],
  ["twiceOf", twiceOf],
  ["lengthOfName", lengthOfName],
  ["weightOfNext", weightOfNext],
  ["bitsOf", bitsOf],
  ["halfOf", halfOf],
  ["firstLetter", firstLetter],
  ["whetherOpen", whetherOpen],
  ["secondOfList", secondOfList],
  ["acted", acted],
];

function readAll(branch: Branch): string {
  return readers.map(([, read]) => attempt(() => read(branch))).join(" ");
}

// The ways.
type Way = (object: object, key: string, value: unknown) => void;

function storeThroughUnknownReceiver(object: any, key: string, value: unknown) {
  switch (key) {
    case "leaf": object.leaf = value; break;
    case "next": object.next = value; break;
    case "kind": object.kind = value; break;
    case "ratio": object.ratio = value; break;
    case "label": object.label = value; break;
    case "open": object.open = value; break;
    case "list": object.list = value; break;
    case "act": object.act = value; break;
    case "weight": object.weight = value; break;
    case "name": object.name = value; break;
  }
}
function storeThroughCast(object: object, key: string, value: unknown) {
  const branch = object as Branch;
  const leaf = object as Leaf;
  switch (key) {
    case "leaf": branch.leaf = value as Leaf; break;
    case "next": branch.next = value as Branch; break;
    case "kind": branch.kind = value as number; break;
    case "ratio": branch.ratio = value as number; break;
    case "label": branch.label = value as string; break;
    case "open": branch.open = value as boolean; break;
    case "list": branch.list = value as number[]; break;
    case "act": branch.act = value as (by: number) => number; break;
    case "weight": leaf.weight = value as number; break;
    case "name": leaf.name = value as string; break;
  }
}
const evaluated = (0, eval)("(function (object, key, value) { object[key] = value; })") as Way;
const evaluatedByName = (0, eval)(
  "(function (object, key, value) { switch (key) { case 'leaf': object.leaf = value; break; case 'next': object.next = value; break; case 'kind': object.kind = value; break; case 'ratio': object.ratio = value; break; case 'label': object.label = value; break; case 'open': object.open = value; break; case 'list': object.list = value; break; case 'act': object.act = value; break; case 'weight': object.weight = value; break; case 'name': object.name = value; break; } })",
) as Way;
const scripted = vm.runInThisContext("(function (object, key, value) { object[key] = value; })") as Way;
const made = new Function("object", "key", "value", "Reflect.set(object, key, value);") as Way;

const ways: [string, Way][] = [
  ["unknown receiver", storeThroughUnknownReceiver],
  ["cast", storeThroughCast],
  ["computed key", (object, key, value) => { (object as any)[key] = value; }],
  ["Object.assign", (object, key, value) => { Object.assign(object, { [key]: value }); }],
  ["defineProperty", (object, key, value) => { Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true }); }],
  ["defineProperty, read only", (object, key, value) => { Object.defineProperty(object, key, { value, writable: false, enumerable: false, configurable: true }); }],
  ["getter", (object, key, value) => { Object.defineProperty(object, key, { get: () => value, configurable: true }); }],
  ["Reflect.set", (object, key, value) => { Reflect.set(object, key, value); }],
  ["Reflect.defineProperty", (object, key, value) => { Reflect.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true }); }],
  ["delete and store", (object, key, value) => { delete (object as any)[key]; (object as any)[key] = value; }],
  ["delete", (object, key) => { delete (object as any)[key]; }],
  ["eval", evaluated],
  ["eval by name", evaluatedByName],
  ["vm", scripted],
  ["new Function", made],
];

const strangers: unknown[] = [
  undefined, null, true, 0, -0, 7, 2.5, NaN, 2 ** 31, 2 ** 53, -(2 ** 31) - 1, "text", "", 10n, Symbol.iterator, [1, 2, 3], {}, { weight: "heavy", name: 5 },
  () => "called", new Map(), new Leaf(40, "stranger"), new Date(0), Object.create(null), new Proxy({}, {}),
];
const keysOfBranch = ["leaf", "next", "kind", "ratio", "label", "open", "list", "act"];
const keysOfLeaf = ["weight", "name"];

function fresh(seed: number): Branch {
  return new Branch(seed, new Branch(seed + 10, undefined));
}

// Warm: the readers have seen what is declared.
let warm = "";
for (let turn = 0; turn < 50; turn++) warm = readAll(fresh(turn));
console.log("honest", warm);

for (const [nameOfWay, way] of ways) {
  for (const key of keysOfBranch) {
    const lines: string[] = [];
    for (const stranger of strangers) {
      const branch = fresh(3);
      way(branch, key, stranger);
      lines.push(readAll(branch));
    }
    console.log(nameOfWay, key, lines.join(" | "));
  }
  for (const key of keysOfLeaf) {
    const lines: string[] = [];
    for (const stranger of strangers) {
      const branch = fresh(4);
      way(branch.leaf, key, stranger);
      way(branch.next!.leaf, key, stranger);
      lines.push(readAll(branch));
    }
    console.log(nameOfWay, "leaf." + key, lines.join(" | "));
  }
}

// Between two reads of one function.
function betweenTwoReads(branch: Branch, deed: () => void): string {
  const before = branch.leaf.weight + branch.kind;
  deed();
  return show(before) + " " + attempt(() => (branch.leaf.weight as any) + branch.kind);
}
// In a loop, in the middle of its turns.
function inLoop(branch: Branch, deed: () => void): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    if (turn === 5) deed();
    text += attempt(() => (branch.leaf.weight as any) + (branch.kind & 3) + branch.label.length) + ";";
  }
  return text;
}
// In a callee, two calls down.
function lowest(deed: () => void) {
  deed();
}
function middle(deed: () => void) {
  lowest(deed);
}
function inCallee(branch: Branch, deed: () => void): string {
  const leaf = branch.leaf;
  const before = leaf.weight;
  middle(deed);
  return show(before) + " " + attempt(() => leaf.weight) + " " + attempt(() => branch.leaf.weight) + " " + attempt(() => branch.leaf.twice());
}
// In a getter that runs in the middle of a row of reads of one object.
class Watched extends Branch {
  deed: (() => void) | undefined = undefined;
  get trap(): number {
    if (this.deed) this.deed();
    return 1;
  }
}
function throughGetter(watched: Watched): string {
  return attempt(() => (watched.leaf.weight as any) + watched.trap + (watched.leaf.weight as any) + watched.kind + watched.label.length);
}

for (const [nameOfWay, way] of ways) {
  const lines: string[] = [];
  for (const stranger of strangers) {
    let branch = fresh(5);
    lines.push(betweenTwoReads(branch, () => { way(branch, "leaf", stranger); way(branch, "kind", stranger); }));
    branch = fresh(6);
    lines.push(betweenTwoReads(branch, () => way(branch.leaf, "weight", stranger)));
    branch = fresh(7);
    lines.push(inLoop(branch, () => { way(branch, "leaf", stranger); way(branch, "kind", stranger); way(branch, "label", stranger); }));
    branch = fresh(8);
    lines.push(inLoop(branch, () => way(branch.leaf, "weight", stranger)));
    branch = fresh(9);
    lines.push(inCallee(branch, () => { way(branch.leaf, "weight", stranger); way(branch, "leaf", stranger); }));
    const watched = new Watched(10, undefined);
    watched.deed = () => { way(watched, "leaf", stranger); way(watched, "kind", stranger); way(watched, "label", stranger); };
    lines.push(throughGetter(watched));
  }
  console.log("in the middle,", nameOfWay, lines.join(" | "));
}

// A field that has left its slot comes back with a value that fits, and leaves again.
{
  const branch = fresh(11);
  const lines: string[] = [];
  for (let turn = 0; turn < 6; turn++) {
    storeThroughCast(branch, "leaf", turn % 2 ? new Leaf(turn, "back" + turn) : "gone" + turn);
    storeThroughCast(branch, "kind", turn % 2 ? turn : "kind" + turn);
    lines.push(readAll(branch));
  }
  console.log("back and forth", lines.join(" | "));
}
