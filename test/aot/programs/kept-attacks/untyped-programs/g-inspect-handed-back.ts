// Untyped programs: g inspect handed back. It prints what plain Bun prints.
const custom = Symbol.for("nodejs.util.inspect.custom");
type Inspect = (value: unknown, ...rest: any[]) => string;
class Wrapper {
  [custom](depth: number, options: object, inspect: Inspect): string {
    const tries: [string, () => string][] = [
      ["map", () => inspect(new Map<unknown, unknown>([[1, { a: 1 }]]))],
      ["set", () => inspect(new Set([1]))],
      ["object", () => inspect({ a: 1 })],
      ["array", () => inspect([1, "two", 3n])],
      ["symbol", () => inspect(Symbol("s"))],
      ["nothing", () => (inspect as any)()],
    ];
    return tries.map(([name, run]) => { try { return name + "=" + run(); } catch (e) { return name + " THREW " + (e as Error).message; } }).join("; ");
  }
}
console.log(new Wrapper());
