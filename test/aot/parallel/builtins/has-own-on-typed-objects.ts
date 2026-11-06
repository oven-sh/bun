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
type Point = { x: number; y?: number };
function hasEach(p: Point): boolean[] {
  return [Object.hasOwn(p, "x"), Object.hasOwn(p, "y"), Object.hasOwn(p, "zzz"), Object.hasOwn(p, "extra")];
}
function changeFields(p: Point): unknown {
  const initial = hasEach(p);
  p.y = 2;
  const stored = hasEach(p);
  delete p.y;
  const withoutY = hasEach(p);
  delete (p as any).x;
  return [initial, stored, withoutY, hasEach(p), Object.keys(p)];
}
function addExtra(p: Point): Point {
  (p as any).extra = 1;
  return p;
}
const tag = Symbol("tag");
type Tagged = { title: string; [tag]: number; size?: number };
function listKeys(o: Tagged): unknown {
  const symbols = Object.getOwnPropertySymbols(o).map(String),
    all = Reflect.ownKeys(o).map(String);
  return [Object.keys(o), Object.getOwnPropertyNames(o), symbols, all];
}
report("point", () => changeFields({ x: 1 }));
report("point created with y", () => changeFields({ x: 1, y: 5 }));
report("point with an extra property", () => changeFields(addExtra({ x: 1 })));
report("symbol field", () => listKeys({ title: "t", [tag]: 1 }));
report("symbol field first", () => listKeys({ [tag]: 2, size: 3, title: "u" }));
