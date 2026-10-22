// Function, Object, Iterator<T>, the native errors and the wrapper types are interfaces for TypeScript, so a location of such a type is not held to a class: any function fits `Function`, anything fits `Object`, and any object fits an error type, an iterator type or a wrapper type, as do the primitives that satisfy a wrapper type.
class Countdown {
  constructor(private from: number) {}
  [Symbol.iterator](): Iterator<number> {
    let next = this.from;
    return { next: () => (next > 0 ? { done: false, value: next-- } : { done: true, value: undefined }) };
  }
}
class ParseError extends SyntaxError {}
function* letters(): Generator<string> {
  yield "g";
}
function hide(value: unknown): any {
  return value;
}

function callWith2(listener: Function): unknown {
  return listener(2);
}
function describeRange(error: RangeError): string {
  return error.name + ": " + error.message;
}
function describeSyntax(error: SyntaxError): string {
  return error.name + ": " + error.message;
}
function createTypeError(): TypeError {
  return new TypeError("a result");
}
function throwRangeError(): void {
  throw new RangeError("an assertion");
}
function keysOf(value: Object): string {
  return Object.keys(value).join();
}
function lengthOf(text: String): number {
  return text.length;
}
function format(value: Number): string {
  return value.toFixed(1);
}
function negate(value: Boolean): boolean {
  return !value.valueOf();
}
function first(values: Iterator<string>): string {
  const step = values.next();
  return step.done ? "none" : step.value;
}
function describeThrown(run: () => void): string {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return describeRange(error as RangeError);
  }
}

const errors: TypeError[] = [createTypeError(), new TypeError("an element")];

console.log("Function:", callWith2((n: number) => n + 1), callWith2(Math.sqrt), callWith2(String));
console.log("Function, bound:", callWith2(lengthOf.bind(null, "bound")));
console.log("RangeError:", describeRange(new RangeError("a parameter")), describeThrown(throwRangeError));
console.log("SyntaxError:", describeSyntax(new SyntaxError("a parameter")));
console.log("SyntaxError, a subclass:", describeSyntax(new ParseError("a parameter")));
console.log("TypeError:", errors.map(error => error.message).join());
console.log("Object:", keysOf({ a: 1, b: 2 }), keysOf([7, 8]), keysOf("xy"), keysOf(hide));
console.log("String:", lengthOf("four"), lengthOf(new String("three")));
console.log("Number:", format(1.5), format(new Number(2)));
console.log("Boolean:", negate(true), negate(new Boolean(false)));
console.log("Iterator, of the program:", [...new Countdown(3)].join());
console.log("Iterator, built in:", first(["a"].values()), first(new Set(["s"]).values()), first(letters()));
console.log("another error:", describeRange(hide({ name: "n", message: "m" })));
console.log("another string:", lengthOf(hide([1, 2])));
console.log("another iterator:", first(hide({ next: () => ({ done: false, value: "v" }) })));
