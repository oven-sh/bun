// Exports of start-up modules: console.log hands util.inspect itself to a custom inspect method, and the program calls it with every form of its second parameter.
const custom = Symbol.for("nodejs.util.inspect.custom");
type Inspect = (value: unknown, ...rest: any[]) => string;

let total = 0;

class Wrapper {
  inner = { a: { b: { c: { d: 1 } } }, list: [1, "two", 3n] };
  [custom](depth: number, options: object, inspect: Inspect): string {
    total += inspect(this.inner, options).length;
    total += inspect(this.inner, { ...options, depth: 0 }).length * 10;
    total += inspect(this.inner, { depth: null, compact: true, breakLength: Infinity }).length * 100;
    total += inspect(this.inner, true, 1, false).length * 1000;
    total += inspect(this.inner, 5).length * 10000;
    total += inspect(this.inner, "text").length * 100000;
    total += inspect(new Map<unknown, unknown>([[1, { a: 1 }], ["k", new Set([1])]]), undefined).length;
    total += inspect(Symbol("s")).length + inspect(-0).length + inspect(undefined).length + (inspect as any)().length;
    return "wrapper";
  }
}

console.log(new Wrapper());
console.log(total);
