// Objects whose constructor stores little and whose factory stores the rest: every place that makes them, some places, one place under a condition.
// What lies where in the object must not show: key order, enumeration, deletion, redefinition, freezing, a `this` that leaks early, a factory that throws half way.

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}

class Signature {
  flags: number;
  checker?: object;
  declaration?: string;
  typeParameters?: string[];
  parameters?: string[];
  thisParameter?: string;
  resolvedReturnType?: string;
  resolvedTypePredicate?: string;
  minArgumentCount?: number;
  resolvedMinArgumentCount?: number;
  target?: Signature;
  mapper?: (name: string) => string;
  compositeSignatures?: Signature[];
  compositeKind?: number;
  constructor(checker: object | undefined, flags: number) {
    this.flags = flags;
    if (checker) this.checker = checker;
  }
}

function createSignature(declaration: string | undefined, typeParameters: string[] | undefined, thisParameter: string | undefined, parameters: string[], resolvedReturnType: string | undefined, minArgumentCount: number, flags: number) {
  const signature = new Signature(undefined, flags);
  signature.declaration = declaration;
  signature.typeParameters = typeParameters;
  signature.parameters = parameters;
  signature.thisParameter = thisParameter;
  signature.resolvedReturnType = resolvedReturnType;
  signature.resolvedTypePredicate = undefined;
  signature.minArgumentCount = minArgumentCount;
  signature.resolvedMinArgumentCount = undefined;
  signature.target = undefined;
  signature.mapper = undefined;
  signature.compositeSignatures = undefined;
  signature.compositeKind = undefined;
  return signature;
}

function cloneSignature(signature: Signature) {
  const result = createSignature(signature.declaration, signature.typeParameters, signature.thisParameter, signature.parameters!, undefined, signature.minArgumentCount!, signature.flags & 3);
  result.target = signature.target;
  result.mapper = signature.mapper;
  result.compositeSignatures = signature.compositeSignatures;
  result.compositeKind = signature.compositeKind;
  return result;
}

{
  const all: Signature[] = [];
  for (let i = 0; i < 300; i++) {
    const made = createSignature(i % 3 ? "d" + i : undefined, i % 5 ? undefined : ["T"], undefined, ["a", "b"].slice(0, i % 3), i % 2 ? "r" + i : undefined, i % 4, i);
    all.push(i % 7 ? made : cloneSignature(made));
  }
  say("keys", Object.keys(all[1]).join());
  say("keys of a clone", Object.keys(all[7]).join());
  say("json", all[5]);
  let sum = 0;
  for (const one of all) sum += one.minArgumentCount! + one.parameters!.length + (one.resolvedReturnType ? 1 : 0) + (one.declaration ? 2 : 0);
  say("sum", sum);
  const seen: string[] = [];
  for (const key in all[2]) seen.push(key);
  say("for in", seen.join());
  say("entries", Object.entries(all[3]).filter(([, value]) => value !== undefined).map(([key]) => key).join());
}

// Deleted, added again, redefined, frozen.
{
  const one = createSignature("d", undefined, undefined, ["p"], "r", 1, 9);
  delete one.parameters;
  say("after delete", Object.keys(one).join());
  say("has", "parameters" in one);
  one.parameters = ["again"];
  say("added again", Object.keys(one).join());
  say("value", one.parameters);
  let reads = 0;
  Object.defineProperty(one, "minArgumentCount", { get() { reads++; return 41 + reads; }, enumerable: true, configurable: true });
  say("accessor", [one.minArgumentCount, one.minArgumentCount, reads]);
  say("descriptor", Object.getOwnPropertyDescriptor(one, "declaration"));
  Object.defineProperty(one, "declaration", { value: "fixed", writable: false });
  let threw = "no";
  try { one.declaration = "other"; } catch (error) { threw = (error as Error).constructor.name; }
  say("read-only", [one.declaration, threw]);
  const frozen = Object.freeze(createSignature("f", undefined, undefined, [], undefined, 0, 0));
  threw = "no";
  try { (frozen as Signature).resolvedReturnType = "x"; } catch (error) { threw = (error as Error).constructor.name; }
  say("frozen", [frozen.resolvedReturnType, threw, Object.isFrozen(frozen)]);
}

// Two factories: both fill `left`, only one fills `right`; a third place fills nothing.
class Pair {
  tag: string;
  left?: number;
  right?: number;
  rest?: number[];
  constructor(tag: string) { this.tag = tag; }
}
function both(left: number, right: number) { const pair = new Pair("both"); pair.left = left; pair.right = right; return pair; }
function onlyLeft(left: number) { const pair = new Pair("left"); pair.left = left; return pair; }
function bare() { return new Pair("bare"); }
{
  const pairs: Pair[] = [];
  for (let i = 0; i < 200; i++) pairs.push(i % 3 === 0 ? both(i, -i) : i % 3 === 1 ? onlyLeft(i) : bare());
  say("pairs", pairs.slice(0, 6));
  say("pair keys", pairs.slice(0, 3).map(pair => Object.keys(pair).join("+")));
  pairs[2].right = 5; pairs[2].left = 6;
  say("late, the other way round", Object.keys(pairs[2]).join("+"));
  let total = 0;
  for (const pair of pairs) total += (pair.left ?? 1000) + (pair.right ?? 100000);
  say("total", total);
}

// The object is seen before the factory has finished, and the factory may throw half way.
class Watched {
  id: number;
  first?: string;
  second?: string;
  third?: string;
  constructor(id: number, early: (made: Watched) => void) { this.id = id; early(this); }
}
const snapshots: string[] = [];
let kept: Watched | undefined;
function makeWatched(id: number, fail: boolean) {
  const made = new Watched(id, early => { snapshots.push(JSON.stringify(early) + Object.keys(early).length); kept = early; });
  made.first = "f" + id;
  if (fail) throw new RangeError("half way " + id);
  made.second = "s" + id;
  made.third = "t" + id;
  return made;
}
{
  for (let i = 0; i < 120; i++) {
    try { makeWatched(i, i % 40 === 39); } catch (error) { say("threw", [(error as Error).message, JSON.stringify(kept), Object.keys(kept!).join()]); }
  }
  say("snapshots", snapshots.slice(0, 2));
  say("last", kept);
}

// A subclass, Reflect.construct with another new.target, and a constructor function.
class Wider extends Pair {
  extra?: string;
  constructor() { super("wider"); }
}
function wider(left: number) { const made = new Wider(); made.left = left; made.extra = "e"; return made; }
function Legacy(this: { kind: number; name?: string; size?: number }, kind: number) { this.kind = kind; }
function legacy(kind: number, name: string, size: number) {
  const made = new (Legacy as unknown as new (kind: number) => { kind: number; name?: string; size?: number })(kind);
  made.name = name;
  made.size = size;
  return made;
}
{
  say("wider", [wider(1), Object.keys(wider(2)).join(), wider(3) instanceof Pair]);
  const odd = Reflect.construct(Pair, ["odd"], Wider) as Wider;
  odd.extra = "first"; odd.left = 3;
  say("another new.target", [odd, odd instanceof Wider, Object.keys(odd).join()]);
  const many = [] as ReturnType<typeof legacy>[];
  for (let i = 0; i < 150; i++) many.push(legacy(i, "n" + i, i * 2));
  say("legacy", [many[149], Object.keys(many[3]).join(), Object.getPrototypeOf(many[0]) === Legacy.prototype]);
  say("spread", { ...many[4], kind: "k" });
  say("assign", Object.assign({}, many[5], both(1, 2)));
}

// More birth fields than a cell takes.
class Wide {
  a0?: number; a1?: number; a2?: number; a3?: number; a4?: number; a5?: number; a6?: number; a7?: number; a8?: number; a9?: number;
  b0?: number; b1?: number; b2?: number; b3?: number; b4?: number; b5?: number; b6?: number; b7?: number; b8?: number; b9?: number;
  c0?: string; c1?: string; c2?: string; c3?: string; c4?: string; c5?: string; c6?: string; c7?: string; c8?: string; c9?: string;
}
function wide(n: number) {
  const w = new Wide();
  w.a0 = n; w.a1 = n + 0.5; w.a2 = n; w.a3 = n; w.a4 = n; w.a5 = n; w.a6 = n; w.a7 = n; w.a8 = n; w.a9 = n;
  w.b0 = n; w.b1 = n; w.b2 = n; w.b3 = n; w.b4 = n; w.b5 = n; w.b6 = n; w.b7 = n; w.b8 = n; w.b9 = -n;
  w.c0 = "x" + n; w.c1 = "x"; w.c2 = "x"; w.c3 = "x"; w.c4 = "x"; w.c5 = "x"; w.c6 = "x"; w.c7 = "x"; w.c8 = "x"; w.c9 = "y" + n;
  return w;
}
{
  const wides: Wide[] = [];
  for (let i = 0; i < 100; i++) wides.push(wide(i));
  say("wide", [wides[99].a1, wides[99].b9, wides[99].c9, Object.keys(wides[50]).length, JSON.stringify(wides[7]).length]);
}

console.log(lines.join("\n"));
