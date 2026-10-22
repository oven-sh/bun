// A read whose value is thrown away still runs the getter; a store of a constant still runs the setter. Every form of access that leaves no value behind for anybody to follow: an expression statement, `void`, a condition, an unused pattern, an update, a compound assignment, a target of a pattern or of a loop, an optional chain, `in`, `delete`.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Target {
  x: number;
  tag: string;
}
const kept: Target[] = [];
const log: string[] = [];
function plain(i: number): Target {
  return { x: i, tag: "plain " + i };
}
function spy(tag: string): Target {
  let value = 1;
  return {
    tag,
    get x() {
      kept.push(this);
      log.push("get");
      return value;
    },
    set x(v: number) {
      kept.push(this);
      log.push("set " + v);
      value = v;
    },
  };
}
class SpyClass {
  private value = 1;
  constructor(public tag: string) {}
  get x(): number {
    kept.push(this);
    log.push("get");
    return this.value;
  }
  set x(v: number) {
    kept.push(this);
    log.push("set " + v);
    this.value = v;
  }
}
const forms: [string, (o: Target) => void][] = [];
function statement(o: Target): void {
  o.x;
}
function voided(o: Target): void {
  void o.x;
}
function condition(o: Target): void {
  if (o.x) {
  }
}
function ternary(o: Target): number {
  return o.x ? 1 : 1;
}
function logical(o: Target): void {
  o.x && 0;
}
function comma(o: Target): number {
  return void o.x, 1;
}
function unusedPattern(o: Target): void {
  const { x } = o;
}
function unusedParameterPattern({ x }: Target): void {}
function restPattern(o: Target): number {
  const { tag, ...rest } = o;
  return 1;
}
function optional(o: Target | null): void {
  o?.x;
}
function byKey(o: Target): void {
  o["x"];
}
function byComputedKey(o: Target, key: "x" = "x"): void {
  o[key];
}
function typeofIt(o: Target): void {
  typeof o.x;
}
function inTemplate(o: Target): void {
  `${o.x}`;
}
function storesAConstant(o: Target): void {
  o.x = 5;
}
function storesZero(o: Target): void {
  o.x = 0;
}
function increments(o: Target): void {
  o.x++;
}
function decrementsInFront(o: Target): void {
  --o.x;
}
function compound(o: Target): void {
  o.x += 2;
}
function logicalAssignment(o: Target): void {
  o.x ||= 7;
  o.x &&= 8;
  o.x ??= 9;
}
function patternTarget(o: Target): void {
  [o.x] = [11];
}
function objectPatternTarget(o: Target): void {
  ({ a: o.x } = { a: 12 });
}
function loopTarget(o: Target): void {
  for (o.x of [13, 14]);
}
function loopInTarget(o: Target): void {
  for ((o as unknown as { x: string }).x in { k: 1 });
}
function byReflectGet(o: Target): void {
  Reflect.get(o, "x");
}
function byReflectSet(o: Target): void {
  Reflect.set(o, "x", 15);
}
function byAssign(o: Target): void {
  Object.assign(o, { x: 16 });
}
function byAssignFrom(o: Target): void {
  Object.assign({}, o);
}
function bySpread(o: Target): void {
  ({ ...o });
}
function byValues(o: Target): void {
  Object.values(o);
}
function switchOnIt(o: Target): void {
  switch (o.x) {
  }
}
function asArgumentNobodyTakes(o: Target): void {
  (() => {})(
    // @ts-ignore: the arrow takes nothing
    o.x,
  );
}
function whileCondition(o: Target): void {
  while (o.x > 1000);
}
function throwsAway(o: Target): void {
  try {
    throw o.x;
  } catch {}
}
forms.push(["statement", statement], ["void", voided], ["condition", condition], ["ternary", ternary], ["logical", logical], ["comma", comma], ["unused pattern", unusedPattern], ["unused parameter pattern", unusedParameterPattern], ["rest pattern", restPattern], ["optional", optional], ["by key", byKey], ["by computed key", byComputedKey], ["typeof", typeofIt], ["template", inTemplate]);
forms.push(["stores a constant", storesAConstant], ["stores zero", storesZero], ["increments", increments], ["decrements", decrementsInFront], ["compound", compound], ["logical assignment", logicalAssignment], ["pattern target", patternTarget], ["object pattern target", objectPatternTarget], ["loop target", loopTarget], ["for-in target", loopInTarget]);
forms.push(["Reflect.get", byReflectGet], ["Reflect.set", byReflectSet], ["assign to", byAssign], ["assign from", byAssignFrom], ["spread", bySpread], ["values", byValues], ["switch", switchOnIt], ["argument nobody takes", asArgumentNobodyTakes], ["while", whileCondition], ["thrown away", throwsAway]);

// Each form at a site of its own, with a fresh object, hot with plain objects and now and then with a spy.
for (let i = 0; i < 300; i++) {
  const o = (name: string): Target => (i % 100 === 99 ? (i === 199 ? new SpyClass(name + " " + i) : spy(name + " " + i)) : plain(i));
  statement(o("statement"));
  voided(o("void"));
  condition(o("condition"));
  ternary(o("ternary"));
  logical(o("logical"));
  comma(o("comma"));
  unusedPattern(o("unused pattern"));
  unusedParameterPattern(o("unused parameter pattern"));
  restPattern(o("rest pattern"));
  optional(o("optional"));
  byKey(o("by key"));
  byComputedKey(o("by computed key"));
  typeofIt(o("typeof"));
  inTemplate(o("template"));
  storesAConstant(o("stores a constant"));
  storesZero(o("stores zero"));
  increments(o("increments"));
  decrementsInFront(o("decrements"));
  compound(o("compound"));
  logicalAssignment(o("logical assignment"));
  patternTarget(o("pattern target"));
  objectPatternTarget(o("object pattern target"));
  loopTarget(o("loop target"));
  loopInTarget(o("for-in target"));
  byReflectGet(o("Reflect.get"));
  byReflectSet(o("Reflect.set"));
  byAssign(o("assign to"));
  byAssignFrom(o("assign from"));
  bySpread(o("spread"));
  byValues(o("values"));
  switchOnIt(o("switch"));
  asArgumentNobodyTakes(o("argument nobody takes"));
  whileCondition(o("while"));
  throwsAway(o("thrown away"));
}
console.log(churn(80), kept.length, log.length);
const seen = new Map<string, number>();
for (const k of kept) seen.set(k.tag, (seen.get(k.tag) ?? 0) + 1);
console.log([...seen].map(([tag, n]) => tag + ":" + n).join(" | "));
kept.length = 0;
log.length = 0;
for (const [name, form] of forms) {
  form(spy(name));
  console.log(name + ": " + log.splice(0).join(","));
}
console.log(churn(40), kept.length, new Set(kept).size);

// What does not read.
kept.length = 0;
function asksOnly(o: Target): string {
  return [("x" in o), Object.hasOwn(o, "x"), Object.keys(o).length, typeof Object.getOwnPropertyDescriptor(o, "x")!.get, o.hasOwnProperty("x"), Object.getOwnPropertyNames(o).length].join();
}
function removes(o: Partial<Target>): boolean {
  return delete o.x;
}
console.log(asksOnly(spy("asked")), removes(spy("removed")), kept.length, log.length);
