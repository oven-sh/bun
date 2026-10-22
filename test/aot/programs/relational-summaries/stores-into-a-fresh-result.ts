// "The result is an object made here, and these are all the stores into it: field f holds parameter 0." The caller then knows the kind of `make(1).f` without a test. The list must hold every store: the second one on a rare path, the one in a loop, under a computed key, by an update, through `this` in a method, by a later member of the same literal; and what takes a member away again.
type Any = number | string | boolean | null | undefined | { tag: string };
interface Box {
  f: Any;
  g?: Any;
}
const kind = (x: unknown): string => (x === null ? "null" : typeof x === "object" ? "object" : typeof x + ":" + String(x));
function once(a: Any): Box {
  return { f: a };
}
function secondOnARarePath(a: Any, b: Any, both: boolean): Box {
  const o: Box = { f: a };
  if (both) o.f = b;
  return o;
}
function inALoop(values: Any[]): Box {
  const o: Box = { f: 0 };
  for (const v of values) o.f = v;
  return o;
}
function underAComputedKey(a: Any, key: "f" | "g", b: Any): Box {
  const o: Box = { f: a };
  o[key] = b;
  return o;
}
function computedInTheLiteral(a: Any, key: string, b: Any): Box {
  return { f: a, [key]: b } as Box;
}
function twiceInTheLiteral(a: Any, b: Any): Box {
  const more: Partial<Box> = { f: b };
  return { f: a, ...more };
}
function spreadFirst(a: Any, from: Partial<Box>): Box {
  return { ...from, f: a };
}
function spreadLast(a: Any, from: Partial<Box>): Box {
  return { f: a, ...from };
}
function updated(a: number): Box {
  const o: Box = { f: a };
  (o.f as number)++;
  return o;
}
function compound(a: number, b: Any): Box {
  const o: Box = { f: a };
  (o.f as any) += b;
  return o;
}
function logicalAssignment(a: Any, b: Any): Box {
  const o: Box = { f: a };
  o.f ??= b;
  o.f ||= b;
  return o;
}
function byPattern(a: Any, b: Any): Box {
  const o: Box = { f: a };
  [o.f] = [b];
  return o;
}
function deleted(a: Any, really: boolean): Partial<Box> {
  const o: Partial<Box> = { f: a };
  if (really) delete o.f;
  return o;
}
function swapped(a: Any, b: Any): Box {
  const o: Box = { f: a, g: b };
  [o.f, o.g] = [o.g, o.f];
  return o;
}
function inTry(a: Any, b: Any, fail: boolean): Box {
  const o: Box = { f: a };
  try {
    if (fail) throw 0;
    o.f = b;
  } catch {}
  return o;
}
function inFinally(a: Any, b: Any): Box {
  const o: Box = { f: a };
  try {
    return o;
  } finally {
    o.f = b;
  }
}
function byAClosure(a: Any, b: Any, call: boolean): Box {
  const o: Box = { f: a };
  const set = () => {
    o.f = b;
  };
  if (call) set();
  return o;
}
function byAHelper(a: Any, b: Any): Box {
  const o: Box = { f: a };
  overwrite(o, b);
  return o;
}
function overwrite(o: Box, b: Any): void {
  o.f = b;
}
function byAssign(a: Any, b: Any): Box {
  return Object.assign({ f: a }, { f: b });
}
function byDefine(a: Any, b: Any): Box {
  return Object.defineProperty({ f: a }, "f", { value: b });
}
function throughAnAlias(a: Any, b: Any): Box {
  const o: Box = { f: a };
  const holder = { o };
  holder.o.f = b;
  return o;
}
function oneOfTwo(a: Any, b: Any, first: boolean): Box {
  const x: Box = { f: a };
  const y: Box = { f: b };
  const chosen = first ? x : y;
  chosen.f = "written through the chosen one";
  return x;
}
class Cell {
  f: Any;
  constructor(a: Any, b: Any, both: boolean) {
    this.f = a;
    if (both) this.reset(b);
  }
  reset(b: Any): void {
    this.f = b;
  }
}
class WithInitializer {
  f: Any = "initial";
  constructor(a: Any, store: boolean) {
    if (store) this.f = a;
  }
}
class Heir extends Cell {
  constructor(a: Any, b: Any) {
    super(a, b, false);
    this.f = b;
  }
}
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += (once(i).f as number) + (secondOnARarePath(i, "s", false).f as number) + (inALoop([i]).f as number) + (underAComputedKey(i, "g", "s").f as number) + (updated(i).f as number) + (compound(i, 1).f as number) + (inTry(i, 1, true).f as number) + (byAClosure(i, "s", false).f as number);
  warm += (new Cell(i, "s", false).f as number) + (new WithInitializer(i, true).f as number) + (new Heir("s", i).f as number) + (swapped("s", i).f as number) + (deleted(i, false).f as number) + (spreadFirst(i, {}).f as number) + (spreadLast(i, {}).f as number);
}
console.log(warm);
const o = { tag: "object" };
console.log([once(1).f, once("s").f, once(null).f, once(undefined).f, once(o).f, once(1.5).f, once(-0).f].map(kind).join());
console.log([secondOnARarePath(1, "s", true).f, secondOnARarePath(1, "s", false).f, secondOnARarePath(1, undefined, true).f, inALoop([]).f, inALoop([1, "s"]).f, inALoop([1, null]).f].map(kind).join());
console.log([underAComputedKey(1, "f", "s").f, underAComputedKey(1, "g", "s").f, underAComputedKey(1, "g", "s").g, computedInTheLiteral(1, "f", "s").f, computedInTheLiteral(1, "g", "s").f, computedInTheLiteral(1, ["f"].join(""), o).f, twiceInTheLiteral(1, "s").f].map(kind).join());
console.log([spreadFirst(1, { f: "s" }).f, spreadLast(1, { f: "s" }).f, spreadLast(1, {}).f, spreadLast(1, { f: undefined }).f, spreadLast(1, { g: "s" }).f, spreadLast(1, { get f() { return "from a getter"; } }).f].map(kind).join());
console.log([updated(1).f, updated(2147483647).f, updated(0.5).f, updated("5" as unknown as number).f, compound(1, 1).f, compound(1, "s").f, compound(1, null).f, compound(1, undefined).f, compound(2147483647, 1).f, compound(1, o).f].map(kind).join());
console.log([logicalAssignment(null, "s").f, logicalAssignment(0, "s").f, logicalAssignment(1, "s").f, logicalAssignment(undefined, 0).f, byPattern(1, "s").f, deleted(1, true).f, deleted(1, false).f, "f" in deleted(1, true), swapped(1, "s").f, swapped(1, "s").g].map(kind).join());
console.log([inTry(1, "s", false).f, inTry(1, "s", true).f, inFinally(1, "s").f, byAClosure(1, "s", true).f, byAClosure(1, "s", false).f, byAHelper(1, "s").f, byAssign(1, "s").f, byDefine(1, "s").f, throughAnAlias(1, "s").f, oneOfTwo(1, 2, true).f, oneOfTwo(1, 2, false).f].map(kind).join());
console.log([new Cell(1, "s", true).f, new Cell(1, "s", false).f, new WithInitializer(1, true).f, new WithInitializer(1, false).f, new Heir(1, "s").f, new Heir("s", 1).f].map(kind).join());

// The caller goes on with the field as if it knew its kind.
function plusOne(b: Box): Any {
  return (b.f as number) + 1;
}
function lengthOf(b: Box): number | undefined {
  return (b.f as string).length;
}
console.log([plusOne(secondOnARarePath(1, "s", true)), plusOne(secondOnARarePath(1, "s", false)), plusOne(underAComputedKey(1, "f", "s")), plusOne(inFinally(1, "s")), plusOne(byAHelper(1, null)), plusOne(new Cell(1, "s", true)), plusOne(updated(2147483647)), lengthOf(secondOnARarePath("abc", 5, true)), lengthOf(secondOnARarePath("abc", 5, false))].map(kind).join());

// Keys that look alike.
function numbered(a: Any, b: Any): Record<string, Any> {
  const r: Record<string, Any> = { 1: a };
  r["1"] = b;
  return r;
}
function numberedApart(a: Any, b: Any): Record<string, Any> {
  const r: Record<string, Any> = { 1: a };
  r["01"] = b;
  r["1.0"] = b;
  return r;
}
console.log(kind(numbered(1, "s")[1]), Object.keys(numbered(1, "s")).join(), kind(numberedApart(1, "s")[1]), Object.keys(numberedApart(1, "s")).join());
