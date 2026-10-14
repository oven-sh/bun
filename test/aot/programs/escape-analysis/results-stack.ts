// A function whose returned object is optimized away still appears exactly once in stack traces, whoever calls it.
declare const console: { log(...v: unknown[]): void };
function names(stack: string): string {
  const found: string[] = [];
  for (const line of stack.split("\n")) {
    const at = /^\s*at (?:async )?([A-Za-z_$][\w$.]*) /.exec(line);
    const name = at ? at[1] : line.includes("@") ? line.split("@")[0] : "";
    if (name && name !== "Error" && name !== "map" && !name.startsWith("module") && !name.startsWith("global")) found.push(name);
  }
  return found.slice(0, 4).join("<");
}
let depth = 0;
function spin(x: number): number { return x < 2 ? x + 1 : spin(x - 1) + spin(x - 2) * 0.5; }
function traced(x: number): { trace: string, size: number } {
  const size = spin(x & 7);
  if (x < 0) return { trace: "negative", size }; //! removed; heap
  return { trace: names(new Error("here").stack as string), size };
}
function failing(x: number): [number, number] {
  const a = spin(x & 7);
  if (x === 3) throw new Error("at three");
  if (a > 100) return [a, 0];
  return [a, a + 1];
}
function reads(x: number): string { const { trace, size } = traced(x); return trace + ":" + size; }
const kept: { trace: string, size: number }[] = [];
function keeps(x: number): string { const t = traced(x); kept.push(t); return t.trace; }
function byValue(f: (x: number) => { trace: string, size: number }, x: number): string { return f(x).trace; }
console.log(reads(4)); console.log(reads(-1)); console.log(keeps(5)); console.log(byValue(traced, 6)); console.log([traced].map(f => f(2).trace).join());
function catches(x: number): string { try { const [a, b] = failing(x); return String(a + b); } catch (e) { return (e as Error).message + " " + names((e as Error).stack as string); } }
console.log(catches(2), catches(3), catches(4));
console.log(traced.name, traced.length, failing.name, failing.length, typeof traced, kept.length, kept[0] === kept[0]);
