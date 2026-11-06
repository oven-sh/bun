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
function assign(source: any): any {
  return Object.assign({}, source);
}
function spread(source: any): any {
  return { ...source };
}
function summarize(o: any): unknown {
  const prototype = Object.getPrototypeOf(o);
  return [show(o.x), Object.keys(o), Object.hasOwn(o, "__proto__"), prototype === Object.prototype];
}
function merge(a: { p: number; q: string }, b: { q: string; r: boolean }) {
  return Object.assign({}, a, b);
}
function gather(sources: Record<string, number>[]): Record<string, number> {
  const all: Record<string, number> = {};
  let index = 0;
  do {
    Object.assign(all, sources[index]);
  } while (++index < sources.length);
  return all;
}
const json = '{"__proto__": {"x": 1}}';
report("assign", () => summarize(assign(JSON.parse(json))));
report("spread", () => summarize(spread(JSON.parse(json))));
report("assign without the key", () => summarize(assign({ x: 2 })));
report("spread without the key", () => summarize(spread({ x: 2 })));
report("two sources", () => merge({ p: 1, q: "a" }, { q: "b", r: true }));
report("two other sources", () => merge({ p: 2, q: "c" }, { q: "d", r: false }));
report("in a loop", () => [gather([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }]), gather([{ z: 0 }])]);
