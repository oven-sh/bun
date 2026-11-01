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
type Subject = { data: number; readonly computed: number };
function make(): Subject {
  return {
    data: 1,
    get computed() {
      return 2;
    },
  };
}
function readFields(o: unknown, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, k);
  const accessors = [typeof d?.get, d?.get?.call(o), typeof d?.set];
  return [d?.value, d?.writable, ...accessors, d?.enumerable, d?.configurable].map(show);
}
function getDescriptor(o: unknown, k: string) {
  return Object.getOwnPropertyDescriptor(o, k);
}
function listFields(o: unknown, k: string): unknown {
  const d = getDescriptor(o, k);
  return d === undefined ? "absent" : Object.keys(d);
}
function reflectValue(o: any, k: string): unknown {
  return Reflect.getOwnPropertyDescriptor(o, k)?.value;
}
for (const k of ["data", "computed", "missing"]) {
  report(k + ", field by field", () => readFields(make(), k));
  report(k + ", escaping", () => listFields(make(), k));
}
report("read-only", () => readFields(Object.defineProperty({}, "fixed", { value: 3 }), "fixed"));
report("length of a string", () => readFields("ab", "length"));
report("Reflect on an object", () => reflectValue(make(), "data"));
report("Reflect on a number", () => reflectValue(1, "x"));
