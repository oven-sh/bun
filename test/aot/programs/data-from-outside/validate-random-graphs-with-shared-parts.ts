// Fuzzes validate<T> with a fixed seed on random object graphs in which the same object or array is reachable by several paths. The result must equal the result for the same value copied out as a tree, must never merge two different objects, and must never contain an object of the argument where T describes it. The argument stays unchanged and each getter is read once per copy. Typed code then reads every field of the result. Some graphs contain a cycle (a RangeError) and some have getters that return something else on each read. With keepsSharing set, an object or array that is shared under one type must stay shared, and graphs that would be astronomically large as trees are made too.
import { validate } from "bun:bundle";

const seed: number = 1;
const rounds: number = 300;
const keepsSharing: boolean = false;

type Leaf = { n: number };
type Wide = { n: number; s?: string };
type Pair = { left: Leaf; right: Leaf; wide: Wide };
type Forked = { left: Forked | null; right: Forked | null };
type Lists = { a: Leaf[]; b: Leaf[]; rows: Leaf[][] };
type Four = [Leaf, Leaf, Leaf[], Wide];
type Named = { d: Record<string, Leaf>; e: Record<string, Leaf>; one: Leaf };
type Tagged = { kind: "a"; item: Leaf; next: Tagged | null } | { kind: "b"; items: Leaf[]; next: Tagged | null };
type Untagged = { a: Leaf; rest: Untagged[] } | { b: Wide; rest: Untagged[] };
type Optional = { x?: Leaf; z: Leaf | null; w?: Optional };
type Loose = { known: Leaf; free: unknown; other: any };
type Tree = { value: Leaf; children: Tree[] };
type Grid = Leaf[][][];
type Late = { p: Leaf[]; inner: Late[]; q: number } | { p: Leaf[]; inner: Late[]; q: string };
type Mixed = { items: (Leaf | string[])[]; more: (Leaf | string[])[] };

let state = seed >>> 0;
function random(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (limit: number): number => Math.floor(random() * limit);
const chance = (probability: number): boolean => random() < probability;

type Description =
  | { is: "number" | "string" | "null" | "unknown"; id: number }
  | { is: "constant"; id: number; value: string }
  | { is: "object"; id: number; fields: [string, Description, boolean][] }
  | { is: "array" | "dictionary"; id: number; item: Description }
  | { is: "tuple"; id: number; items: Description[] }
  | { is: "union"; id: number; arms: Description[] };
let descriptions = 0;
const simple = (is: "number" | "string" | "null" | "unknown"): Description => ({ is, id: descriptions++ });
const constant = (value: string): Description => ({ is: "constant", id: descriptions++, value });
const object = (fields: [string, Description, boolean][]): Description => ({ is: "object", id: descriptions++, fields });
const written = new Map<string, Description>();
function once(parts: Description[], make: () => Description): Description {
  const made = make();
  if (!parts.length) return made;
  const name = made.is + parts.map(part => part.id).join();
  if (!written.has(name)) written.set(name, made);
  return written.get(name)!;
}
const array = (item: Description): Description => once([item], () => ({ is: "array", id: descriptions++, item }));
const dictionary = (item: Description): Description => once([item], () => ({ is: "dictionary", id: descriptions++, item }));
const tuple = (...items: Description[]): Description => once(items, () => ({ is: "tuple", id: descriptions++, items }));
const union = (...arms: Description[]): Description => once(arms, () => ({ is: "union", id: descriptions++, arms }));
const takesRecords = (type: Description): boolean => type.is === "object" || type.is === "dictionary" || type.is === "unknown" || (type.is === "union" && type.arms.some(takesRecords));

const number = simple("number");
const string = simple("string");
const nothing = simple("null");
const unknown = simple("unknown");
const leaf = object([["n", number, false]]);
const wide = object([["n", number, false], ["s", string, true]]);
const pair = object([["left", leaf, false], ["right", leaf, false], ["wide", wide, false]]);
const forked: any = object([]);
forked.fields.push(["left", union(forked, nothing), false], ["right", union(forked, nothing), false]);
const lists = object([["a", array(leaf), false], ["b", array(leaf), false], ["rows", array(array(leaf)), false]]);
const four = tuple(leaf, leaf, array(leaf), wide);
const named = object([["d", dictionary(leaf), false], ["e", dictionary(leaf), false], ["one", leaf, false]]);
const tagged: any = union();
tagged.arms.push(object([["kind", constant("a"), false], ["item", leaf, false], ["next", union(tagged, nothing), false]]), object([["kind", constant("b"), false], ["items", array(leaf), false], ["next", union(tagged, nothing), false]]));
const untagged: any = union();
untagged.arms.push(object([["a", leaf, false], ["rest", array(untagged), false]]), object([["b", wide, false], ["rest", array(untagged), false]]));
const optional: any = object([]);
optional.fields.push(["x", leaf, true], ["z", union(leaf, nothing), false], ["w", optional, true]);
const loose = object([["known", leaf, false], ["free", unknown, false], ["other", unknown, false]]);
const tree: any = object([]);
tree.fields.push(["value", leaf, false], ["children", array(tree), false]);
const grid = array(array(array(leaf)));
const late: any = union();
late.arms.push(object([["p", array(leaf), false], ["inner", array(late), false], ["q", number, false]]), object([["p", array(leaf), false], ["inner", array(late), false], ["q", string, false]]));
const mixed = object([["items", array(union(leaf, array(string))), false], ["more", array(union(leaf, array(string))), false]]);

const modulus = 1000003;
const mix = (sum: number, next: number): number => (sum * 31 + next) % modulus;
const sumOfLeaf = (value: Leaf): number => mix(7, value.n);
const sumOfWide = (value: Wide): number => mix(mix(7, value.n), value.s === undefined ? 5 : value.s.length);
function sumOfLeaves(values: Leaf[]): number {
  let sum = 11;
  for (const value of values) sum = mix(sum, sumOfLeaf(value));
  return sum;
}
function sumOfNames(values: Record<string, Leaf>): number {
  let sum = 17;
  for (const key of Object.keys(values)) sum = mix(mix(sum, key.length), sumOfLeaf(values[key]));
  return sum;
}
function remembered<T extends object>(sumOf: (value: T, again: (value: T) => number) => number): (value: T) => number {
  const sums = new Map<object, number>();
  const again = (value: T): number => {
    let sum = sums.get(value);
    if (sum === undefined) sums.set(value, (sum = sumOf(value, again)));
    return sum;
  };
  return again;
}
const sumOfPair = (value: Pair): number => mix(mix(mix(7, sumOfLeaf(value.left)), sumOfLeaf(value.right)), sumOfWide(value.wide));
const sumOfForked = () => remembered<Forked>((value, again) => mix(mix(7, value.left === null ? 3 : again(value.left)), value.right === null ? 3 : again(value.right)));
function sumOfLists(value: Lists): number {
  let rows = 11;
  for (const row of value.rows) rows = mix(rows, sumOfLeaves(row));
  return mix(mix(mix(7, sumOfLeaves(value.a)), sumOfLeaves(value.b)), rows);
}
const sumOfFour = (value: Four): number => mix(mix(mix(mix(13, sumOfLeaf(value[0])), sumOfLeaf(value[1])), sumOfLeaves(value[2])), sumOfWide(value[3]));
const sumOfNamed = (value: Named): number => mix(mix(mix(7, sumOfNames(value.d)), sumOfNames(value.e)), sumOfLeaf(value.one));
const sumOfTagged = () => remembered<Tagged>((value, again) => mix(mix(mix(7, 1), value.kind === "a" ? sumOfLeaf(value.item) : sumOfLeaves(value.items)), value.next === null ? 3 : again(value.next)));
const sumOfUntagged = () =>
  remembered<Untagged>((value, again) => {
    let rest = 11;
    for (const item of value.rest) rest = mix(rest, again(item));
    return mix(mix(7, "a" in value ? sumOfLeaf(value.a) : sumOfWide(value.b)), rest);
  });
const sumOfOptional = () => remembered<Optional>((value, again) => mix(mix(mix(7, value.x === undefined ? 5 : sumOfLeaf(value.x)), value.z === null ? 3 : sumOfLeaf(value.z)), value.w === undefined ? 5 : again(value.w)));
const sumOfLoose = (value: Loose): number => mix(mix(mix(7, sumOfLeaf(value.known)), 19), 19);
const sumOfTree = () =>
  remembered<Tree>((value, again) => {
    let children = 11;
    for (const child of value.children) children = mix(children, again(child));
    return mix(mix(7, sumOfLeaf(value.value)), children);
  });
function sumOfGrid(value: Grid): number {
  let sum = 11;
  for (const plane of value) {
    let rows = 11;
    for (const row of plane) rows = mix(rows, sumOfLeaves(row));
    sum = mix(sum, rows);
  }
  return sum;
}

const sumOfLate = () =>
  remembered<Late>((value, again) => {
    let inner = 11;
    for (const item of value.inner) inner = mix(inner, again(item));
    return mix(mix(mix(7, sumOfLeaves(value.p)), inner), typeof value.q === "number" ? value.q : value.q.length);
  });
function sumOfEither(values: (Leaf | string[])[]): number {
  let sum = 11;
  for (const value of values) {
    if (Array.isArray(value)) {
      let texts = 11;
      for (const text of value) texts = mix(texts, text.length);
      sum = mix(sum, texts);
    } else sum = mix(sum, sumOfLeaf(value));
  }
  return sum;
}
const sumOfMixed = (value: Mixed): number => mix(mix(7, sumOfEither(value.items)), sumOfEither(value.more));

const isObject = (value: any): boolean => typeof value === "object" && value !== null;
const isRecord = (value: any): boolean => isObject(value) && !Array.isArray(value);

class Walk {
  verdicts = new Map<any, Map<number, boolean>>();
  sums = new Map<any, Map<number, number>>();
  matches(type: Description, value: any): boolean {
    if (!isObject(value) || type.is === "unknown") return this.matchesNow(type, value);
    let known = this.verdicts.get(value);
    if (!known) this.verdicts.set(value, (known = new Map()));
    let verdict = known.get(type.id);
    if (verdict === undefined) known.set(type.id, (verdict = this.matchesNow(type, value)));
    return verdict;
  }
  matchesNow(type: Description, value: any): boolean {
    switch (type.is) {
      case "number":
        return typeof value === "number";
      case "string":
        return typeof value === "string";
      case "null":
        return value === null;
      case "unknown":
        return true;
      case "constant":
        return value === type.value;
      case "object":
        return isRecord(value) && type.fields.every(([name, field, isOptional]) => (name in value ? this.matches(field, value[name]) : isOptional));
      case "array":
        return Array.isArray(value) && value.every((item: any) => this.matches(type.item, item));
      case "dictionary":
        return isRecord(value) && Object.keys(value).every(key => this.matches(type.item, value[key]));
      case "tuple":
        return Array.isArray(value) && value.length === type.items.length && type.items.every((item, at) => this.matches(item, value[at]));
      case "union":
        return type.arms.some(arm => this.matches(arm, value));
    }
  }
  armOf(type: Description, value: any): Description {
    while (type.is === "union") type = type.arms.find(arm => this.matches(arm, value))!;
    return type;
  }
  nodeOf(type: Description, value: any): number {
    while (type.is === "union") {
      if (isRecord(value) && type.arms.filter(takesRecords).length >= 2) return type.id;
      type = type.arms.find(arm => this.matches(arm, value))!;
    }
    return type.id;
  }
  sum(given: Description, value: any): number {
    const type = this.armOf(given, value);
    if (!isObject(value) || type.is === "unknown") return type.is === "number" ? value : type.is === "string" ? value.length : type.is === "null" ? 3 : type.is === "constant" ? 1 : 19;
    let known = this.sums.get(value);
    if (!known) this.sums.set(value, (known = new Map()));
    let sum = known.get(type.id);
    if (sum !== undefined) return sum;
    if (type.is === "object") {
      sum = 7;
      for (const [name, field] of type.fields) sum = mix(sum, value[name] === undefined ? 5 : this.sum(field, value[name]));
    } else if (type.is === "array") {
      sum = 11;
      for (const item of value) sum = mix(sum, this.sum(type.item, item));
    } else if (type.is === "tuple") {
      sum = 13;
      type.items.forEach((item, at) => (sum = mix(sum!, this.sum(item, value[at]))));
    } else if (type.is === "dictionary") {
      sum = 17;
      for (const key of Object.keys(value)) sum = mix(mix(sum, key.length), this.sum(type.item, value[key]));
    }
    known.set(type.id, sum!);
    return sum!;
  }
}

let getterReads = 0;
let quiet = true;
const nestedLeaf = { n: 3 };
const nestedPair = { left: nestedLeaf, right: nestedLeaf, wide: nestedLeaf };
function getter(held: any, others: any[] | null, validatesInside: boolean): () => any {
  let reads = 0;
  return () => {
    if (quiet) return held;
    getterReads++;
    if (validatesInside && (validate<Pair>(nestedPair).right.n !== 3 || JSON.parse<Leaf>('{"n":4}').n !== 4)) throw new Error("a validation inside a getter went wrong");
    return others && reads++ ? others[reads % others.length] : held;
  };
}
class Maker {
  made = new Map<number, any[]>();
  all: any[] = [];
  weights = new Map<any, number>();
  constructor(public sharing: number, public heaviest: number, public getters: number, public changing: boolean) {}
  weigh(value: any): number {
    return isObject(value) ? this.weights.get(value)! : 1;
  }
  keep(type: Description, value: any): any {
    let weight = 1;
    for (const key of Object.keys(value)) weight += this.weigh(value[key]);
    this.weights.set(value, weight);
    let list = this.made.get(type.id);
    if (!list) this.made.set(type.id, (list = []));
    list.push(value);
    this.all.push(value);
    return value;
  }
  reuse(type: Description): any {
    let list = this.made.get(type.id);
    if (type === wide && chance(0.5)) list = this.made.get(leaf.id);
    if (type === leaf && chance(0.2)) list = this.made.get(wide.id);
    if (!list || !list.length || !chance(this.sharing)) return undefined;
    const value = list[below(list.length)];
    return this.weigh(value) <= this.heaviest ? value : undefined;
  }
  make(type: Description, depth: number): any {
    switch (type.is) {
      case "number":
        return below(2000) - 1000;
      case "string":
        return "abcdefgh".slice(below(8));
      case "null":
        return null;
      case "constant":
        return type.value;
      case "unknown":
        return this.all.length && chance(0.7) ? this.all[below(this.all.length)] : below(10);
      case "union": {
        const flat = type.arms.filter(arm => arm.is === "null");
        return this.make(depth > 7 && flat.length ? flat[0] : type.arms[below(type.arms.length)], depth);
      }
    }
    const again = this.reuse(type);
    if (again !== undefined) return again;
    const count = depth > 7 ? 0 : below(this.heaviest === Infinity ? 60 : depth > 3 ? 3 : 5);
    if (type.is === "array") return this.keep(type, Array.from({ length: count }, () => this.make(type.item, depth + 1)));
    if (type.is === "tuple") return this.keep(type, type.items.map(item => this.make(item, depth + 1)));
    const value: any = {};
    if (type.is === "dictionary") for (let at = 0; at < count; at++) value["k" + below(12)] = this.make(type.item, depth + 1);
    else if (type.is === "object") {
      let fields = type.fields.filter(field => !field[2] || (depth <= 7 && chance(0.6)));
      if (chance(0.2)) fields = fields.slice().reverse();
      for (const [name, field] of fields) {
        const held = this.make(field, depth + 1);
        if (chance(this.getters)) Object.defineProperty(value, name, { get: getter(held, this.changing ? ["wrong", null, 5, [], {}, this.all.length ? this.all[below(this.all.length)] : 1, held] : null, chance(0.3)), enumerable: true, configurable: true });
        else value[name] = held;
        if (chance(0.08)) value["u" + below(4)] = this.all.length && chance(0.7) ? this.all[below(this.all.length)] : below(10);
      }
    }
    return this.keep(type, value);
  }
  spoil(): void {
    const value = this.all[below(this.all.length)];
    const keys = Object.keys(value);
    if (!keys.length) return;
    const key = keys[below(keys.length)];
    if (Object.getOwnPropertyDescriptor(value, key)!.get) return;
    switch (below(6)) {
      case 0:
        value[key] = "wrong";
        break;
      case 1:
        value[key] = null;
        break;
      case 2:
        if (isRecord(value)) delete value[key];
        else value[key] = 5;
        break;
      case 3:
        value[key] = [];
        break;
      case 4:
        value[key] = {};
        break;
      default:
        value[key] = true;
    }
  }
}

function describe(root: any): string {
  const numbers = new Map<any, number>();
  const visit = (value: any): string => {
    if (!isObject(value)) return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
    const known = numbers.get(value);
    if (known !== undefined) return "#" + known;
    numbers.set(value, numbers.size);
    const parts = Object.getOwnPropertyNames(value).map(key => {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      return key + ":" + (property.get ? "getter" : visit(property.value));
    });
    return (Array.isArray(value) ? "[" : "{") + parts.join(",") + (Array.isArray(value) ? "]" : "}");
  };
  return visit(root);
}
function copyAsTree(value: any): any {
  if (!isObject(value)) return value;
  if (Array.isArray(value)) return value.map(copyAsTree);
  const copy: any = {};
  for (const key of Object.keys(value)) copy[key] = copyAsTree(value[key]);
  return copy;
}
function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (!isObject(value)) return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}
function digest(sum: number, text: string): number {
  for (let at = 0; at < text.length; at++) sum = (Math.imul(sum, 31) + text.charCodeAt(at)) | 0;
  return sum;
}

class Identities {
  copies = new Map<any, Map<number, any>>();
  sources = new Map<any, [any, number]>();
  visited = new Map<any, Map<any, Set<number>>>();
  kept = 0;
  lost = 0;
  getters = 0;
  visits = 0;
  fault = "";
  constructor(public walk: Walk) {}
  compare(given: Description, source: any, copy: any, path: string): void {
    if (this.fault) return;
    const type = this.walk.armOf(given, source);
    if (!isObject(source) || type.is === "unknown") {
      if (!Object.is(source, copy)) this.fault = "at " + path + " the result holds another value than the argument";
      return;
    }
    if (!isObject(copy)) return void (this.fault = "at " + path + " the result holds no object");
    if (copy === source) return void (this.fault = "at " + path + " the result holds the argument's own object");
    let bySource = this.visited.get(source);
    if (!bySource) this.visited.set(source, (bySource = new Map()));
    let byCopy = bySource.get(copy);
    if (!byCopy) bySource.set(copy, (byCopy = new Set()));
    if (byCopy.has(type.id)) return void this.kept++;
    byCopy.add(type.id);
    if (++this.visits > 3000000) return void (this.fault = "the result has far more objects than the argument");
    const node = this.walk.nodeOf(given, source);
    const from = this.sources.get(copy);
    if (!from) this.sources.set(copy, [source, node]);
    else if (from[0] !== source) return void (this.fault = "at " + path + " one object of the result stands for two objects of the argument");
    else if (from[1] !== node) return void (this.fault = "at " + path + " one object of the result is used under two types");
    let known = this.copies.get(source);
    if (!known) this.copies.set(source, (known = new Map()));
    const earlier = known.get(node);
    if (earlier === undefined) known.set(node, copy);
    else if (earlier === copy) this.kept++;
    else {
      this.lost++;
      if (keepsSharing) return void (this.fault = "at " + path + " an object that the argument shares under one type was copied twice");
    }
    for (const key of Object.keys(source)) if (Object.getOwnPropertyDescriptor(source, key)!.get) this.getters++;
    if (type.is === "object") {
      const declared = new Set(type.fields.map(field => field[0]));
      for (const [name, field] of type.fields) if (name in source) this.compare(field, source[name], copy[name], path + "." + name);
      for (const key of Object.keys(source)) if (!declared.has(key) && source[key] !== copy[key]) this.fault = "at " + path + "." + key + " an undeclared key holds another value than in the argument";
    } else if (type.is === "array") source.forEach((item: any, at: number) => this.compare(type.item, item, copy[at], path + "." + at));
    else if (type.is === "tuple") type.items.forEach((item, at) => this.compare(item, source[at], copy[at], path + "." + at));
    else if (type.is === "dictionary") for (const key of Object.keys(source)) this.compare(type.item, source[key], copy[key], path + "." + key);
  }
}

let reported = 0;
function report(what: string, label: string, round: number, value: any, more: string): void {
  if (reported++ < 12) console.log(what + ": " + label + ", seed " + seed + ", round " + round + ": " + more.slice(0, 500) + "\n  " + describe(value).slice(0, 700));
}
function outcome(run: () => unknown): { value?: any; error: string } {
  try {
    return { value: run(), error: "" };
  } catch (error: any) {
    if (error.name === "TypeError" && error.issues?.length > 0) return { error: "rejected: " + JSON.stringify(error.issues.map((issue: any) => issue.path)) };
    return { error: error.name + ": " + error.message };
  }
}

type Tie = ((inner: any, root: any) => any) | null;
const types: [string, Description, (value: unknown) => unknown, (value: unknown) => unknown, () => (value: any) => number, Tie][] = [
  ["Pair", pair, value => validate<Pair>(value), value => JSON.parse<Pair>("0", () => value), () => sumOfPair, null],
  ["Forked", forked, value => validate<Forked>(value), value => JSON.parse<Forked>("0", () => value), sumOfForked, (inner, root) => (inner.left = root)],
  ["Lists", lists, value => validate<Lists>(value), value => JSON.parse<Lists>("0", () => value), () => sumOfLists, null],
  ["Four", four, value => validate<Four>(value), value => JSON.parse<Four>("0", () => value), () => sumOfFour, null],
  ["Named", named, value => validate<Named>(value), value => JSON.parse<Named>("0", () => value), () => sumOfNamed, null],
  ["Tagged", tagged, value => validate<Tagged>(value), value => JSON.parse<Tagged>("0", () => value), sumOfTagged, (inner, root) => (inner.next = root)],
  ["Untagged", untagged, value => validate<Untagged>(value), value => JSON.parse<Untagged>("0", () => value), sumOfUntagged, (inner, root) => inner.rest.push(root)],
  ["Optional", optional, value => validate<Optional>(value), value => JSON.parse<Optional>("0", () => value), sumOfOptional, (inner, root) => (inner.w = root)],
  ["Loose", loose, value => validate<Loose>(value), value => JSON.parse<Loose>("0", () => value), () => sumOfLoose, null],
  ["Tree", tree, value => validate<Tree>(value), value => JSON.parse<Tree>("0", () => value), sumOfTree, (inner, root) => inner.children.push(root)],
  ["Grid", grid, value => validate<Grid>(value), value => JSON.parse<Grid>("0", () => value), () => sumOfGrid, null],
  ["Late", late, value => validate<Late>(value), value => JSON.parse<Late>("0", () => value), sumOfLate, (inner, root) => inner.inner.push(root)],
  ["Mixed", mixed, value => validate<Mixed>(value), value => JSON.parse<Mixed>("0", () => value), () => sumOfMixed, null],
];

for (const [label, type, direct, revive, sumOf, tie] of types) {
  let accepted = 0;
  let rejected = 0;
  let different = 0;
  let kept = 0;
  let lost = 0;
  let shapes = 0;
  let graphs = 0;
  let reads = 0;
  let readsWhereRejected = 0;
  let huge = 0;
  let cycles = 0;
  let changing = 0;
  for (let round = 0; round < rounds; round++) {
    const kind = below(20);
    const isHuge = keepsSharing && kind === 0;
    const isChanging = kind === 1;
    const hasCycle = kind === 2 && tie !== null && round % 4 === 0;
    const maker = new Maker(isHuge ? 0.95 : [0, 0.3, 0.6, 0.9][below(4)], isHuge ? Infinity : 300, isChanging ? 0.3 : hasCycle ? 0 : 0.03, isChanging);
    let value = maker.make(type, 0);
    if (isHuge) for (let more = 10 + below(40); more > 0; more--) value = maker.make(type, 0);
    if (!isObject(value) || (!isHuge && maker.weigh(value) > 20000)) continue;
    if (!hasCycle && chance(0.3)) for (let count = 1 + below(2); count > 0; count--) maker.spoil();
    graphs++;
    const fail = (what: string, more: string) => (different++, report(what, label, round, value, more));
    const enter = chance(0.25) ? revive : direct;
    const run = (given: any, how = enter) => {
      quiet = false;
      const start = Date.now();
      const result = outcome(() => how(given));
      quiet = true;
      if (!hasCycle && Date.now() - start > 30000) fail("TOO SLOW", Date.now() - start + " ms");
      return result;
    };
    if (hasCycle) {
      cycles++;
      tie!(value, value);
      const before = describe(value);
      const result = run(value);
      if (!result.error.startsWith("RangeError: ")) fail("A CYCLE DID NOT END IN A RANGE ERROR", result.error);
      if (describe(value) !== before) fail("THE ARGUMENT CHANGED", before);
      continue;
    }
    if (isChanging) {
      changing++;
      const result = run(value, direct);
      if (result.error) {
        if (!result.error.startsWith("rejected: ")) fail("NOT A TYPE ERROR WITH ISSUES", result.error);
        continue;
      }
      const walk = new Walk();
      if (!walk.matches(type, result.value)) fail("THE RESULT DOES NOT MATCH ITS TYPE", describe(result.value));
      else if (sumOf()(result.value) !== walk.sum(type, result.value)) fail("TYPED CODE READS OTHER VALUES", describe(result.value));
      continue;
    }
    const walk = new Walk();
    const before = describe(value);
    const matches = walk.matches(type, value);
    const readsBefore = getterReads;
    const result = run(value);
    const readsNow = getterReads - readsBefore;
    if (describe(value) !== before) fail("THE ARGUMENT CHANGED", before);
    if (matches !== (result.error === "")) {
      fail(matches ? "REJECTED A VALUE THAT MATCHES" : "ACCEPTED A VALUE THAT DOES NOT MATCH", result.error);
      continue;
    }
    if (isHuge) huge++;
    const asTree = isHuge ? result : run(copyAsTree(value), direct);
    if (!matches) {
      rejected++;
      readsWhereRejected += readsNow;
      if (!result.error.startsWith("rejected: ")) fail("NOT A TYPE ERROR WITH ISSUES", result.error);
      else if (result.error !== asTree.error) fail("OTHER ISSUES THAN FOR THE TREE", result.error + " | " + asTree.error);
      shapes = digest(shapes, result.error);
      continue;
    }
    accepted++;
    reads += readsNow;
    // JSON.parse<T> checks what a reviver returns and hands it on as it is: the program holds that object, and a copy would be another one.
    if (enter === revive) {
      if (result.value !== value) fail("WHAT THE REVIVER RETURNED WAS COPIED", describe(result.value));
      continue;
    }
    if (!isHuge && (asTree.error || show(result.value) !== show(asTree.value))) fail("ANOTHER RESULT THAN FOR THE TREE", asTree.error || show(result.value) + " | " + show(asTree.value));
    const identities = new Identities(walk);
    identities.compare(type, value, result.value, "");
    if (identities.fault) fail("IDENTITY", identities.fault + " | " + describe(result.value));
    else if (readsNow !== identities.getters) fail("GETTERS", "read " + readsNow + " times, expected " + identities.getters);
    kept += identities.kept;
    lost += identities.lost;
    const expected = walk.sum(type, value);
    const read = sumOf()(result.value);
    if (read !== expected) fail("TYPED CODE READS OTHER VALUES", read + " | " + expected);
    const again = run(result.value, direct);
    if (again.error || describe(again.value) !== describe(result.value)) fail("THE RESULT DOES NOT VALIDATE AGAIN", again.error);
    shapes = digest(shapes, describe(result.value));
  }
  console.log(label + ": " + graphs + " graphs: " + accepted + " accepted, " + rejected + " rejected, " + huge + " huge, " + cycles + " with a cycle, " + changing + " with changing getters; shared parts kept " + kept + ", copied again " + lost + "; getters read " + reads + " times" + (keepsSharing ? ", " + readsWhereRejected + " times where rejected" : "") + "; digest " + (shapes >>> 0).toString(16) + ": " + different + " differ");
}
