// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
type Pair = { left: number; right: number };
function create(): Pair {
  return { left: 1, right: 2 };
}
function createFrozen(left: number, right: number) {
  return Object.freeze({ left, right });
}
function createBare(k: number): any {
  const o = Object.create(null);
  o.k = k;
  return o;
}
function freeze(p: Pair): Pair {
  Object.freeze(p);
  return p;
}
function addExtra(p: Pair): Pair {
  (p as any).extra = 1;
  return p;
}
function store(p: Pair, value: number): number {
  p.left = value;
  return p.left;
}
function summarize(p: Readonly<Pair>): unknown {
  return [Object.isFrozen(p), p.left, p.right, Object.keys(p)];
}
function summarizeAfterStore(p: Pair): unknown {
  try {
    store(p, 5);
  } catch {}
  return summarize(p);
}
function getPrototype(value: any): unknown {
  return Object.getPrototypeOf(value);
}
function reflectPrototype(value: any): unknown {
  return Reflect.getPrototypeOf(value);
}
report("not frozen", () => [store(create(), 5), summarizeAfterStore(create())]);
report("frozen", () => summarize(freeze(create())));
report("store to a frozen object", () => store(freeze(create()), 5));
report("after that store", () => summarizeAfterStore(freeze(create())));
report("delete from a frozen object", () => delete (freeze(create()) as any).left);
report("frozen with an extra property", () => summarize(freeze(addExtra(create()))));
report("store to the extra property", () => {
  (freeze(addExtra(create())) as any).extra = 2;
});
report("literal frozen at once", () => [summarize(createFrozen(1, 2)), summarize(createFrozen(3, 4))]);
report("store to that literal", () => {
  (createFrozen(1, 2) as any).left = 5;
});
report("no prototype", () => [getPrototype(createBare(1)), Object.keys(createBare(2)), createBare(3).k]);
report("getPrototypeOf", () => [getPrototype(1) === Number.prototype, getPrototype({}) === Object.prototype]);
report("Reflect on an object", () => reflectPrototype({}) === Object.prototype);
report("Reflect on a number", () => reflectPrototype(1));
