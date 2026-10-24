// A method read from an object and then called as a plain function gets no receiver: `this` is undefined, whatever object it came from and whatever the call syntax.
const opaque = new Function("value", "return value") as <T>(value: T) => T;
function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + String(run()));
  } catch (error: any) {
    console.log(label + ": " + error.constructor.name);
  }
}
class Counter {
  count = 7;
  read(): string { return this === undefined ? "no receiver" : "count " + this.count; }
}
const counter = new Counter();
const literal = { tag: "literal", read() { return this === undefined ? "no receiver" : this.tag; } };
const untyped: any = opaque({
  read() { return this === undefined ? "no receiver" : "a receiver"; },
  count(...values: unknown[]) { return (this === undefined ? "no receiver, " : "a receiver, ") + values.length; },
  step(value: number) { return this === undefined ? value : 1000; },
  sloppy: new Function("return this === globalThis ? 'the global object' : typeof this"),
});
const list = [1, 2], table = new Map([["key", 1]]), set = new Set([1]), text = "  x  ";
function callInTailPosition(object: any): unknown {
  const { read } = object;
  return read();
}
function spreadInTailPosition(object: any, values: unknown[]): unknown {
  const { count } = object;
  return count(...values);
}
function callInLoop(object: any, times: number): number {
  const { step } = object;
  let total = 0;
  for (let i = 0; i < times; i++) total += step(i);
  return total;
}
attempt("with a receiver", () => [counter.read(), literal.read(), untyped.read(), untyped.count(1, 2), untyped.step(1)].join("; "));
attempt("a constant", () => { const read = counter.read; return String(read()); });
attempt("destructuring", () => { const { read } = literal; return String(read()); });
attempt("a comma", () => String((0, untyped.read)()));
attempt("a conditional", () => String((counter.count > 0 ? counter.read : literal.read)()));
attempt("a logical or", () => String((untyped.absent || untyped.read)()));
attempt("an assignment", () => { let slot; return String((slot = untyped.read)()); });
attempt("an optional call", () => { const { read } = untyped; return String(read?.()); });
attempt("a tagged template", () => { const { count } = untyped; return String(count`a${1}b`); });
attempt("a spread", () => { const { count } = untyped; return String(count(...[1, 2, 3])); });
attempt("arguments around a spread", () => { const { count } = untyped; return String(count(0, ...[1, 2, 3], 4)); });
attempt("ten arguments", () => { const { count } = untyped; return String(count(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)); });
attempt("tail position", () => opaque(callInTailPosition)(untyped));
attempt("a spread in tail position", () => opaque(spreadInTailPosition)(untyped, [1, 2, 3]));
attempt("a loop", () => callInLoop(untyped, 100));
attempt("a sloppy function", () => { const { sloppy } = untyped; return String(sloppy()); });
attempt("static built-ins", () => { const { max } = Math, { stringify } = JSON, { isArray } = Array, { keys } = Object; return [max(1, 5), stringify([1]), isArray([]), keys({ a: 1 })].join("; "); });
{ const { log } = console; log("console.log: needs no receiver"); }
attempt("Array.prototype.push", () => { const { push } = list; return String(push(3)); });
attempt("Map.prototype.get", () => { const { get } = table; return String(get("key")); });
attempt("Set.prototype.add", () => { const { add } = set; return String(add(2)); });
attempt("String.prototype.trim", () => { const { trim } = text; return String(trim()); });
attempt("Object.prototype.toString", () => { const { toString } = Object.prototype; return String(toString()); });
attempt("Function.prototype.call", () => { const { call }: any = counter.read; return String(call(counter)); });
attempt("Function.prototype.apply", () => { const { apply }: any = counter.read; return String(apply(counter, [])); });
attempt("Function.prototype.bind", () => { const { bind }: any = counter.read; return String(bind(counter)); });
attempt("not a function", () => { const { absent } = untyped; return String(absent()); });
console.log("receivers unchanged: " + [list.length, table.size, set.size].join());
export {};
