// One reader of `.length` and one test of `.length === 0` that know nothing of what they are handed: Buffers and functions as made, and each after what can change the answer
const log: string[] = [];
function lengthOf(thing: any) {
  return thing.length;
}
function isEmpty(thing: any) {
  return thing.length === 0;
}
function tell(label: string, make: () => unknown) {
  try {
    const thing = make();
    let said = "";
    for (let turn = 0; turn < 40; turn++) {
      const now = String(lengthOf(thing)) + " " + isEmpty(thing);
      if (now !== said) said += (said ? " THEN " : "") + now;
    }
    log.push(label + ": " + said);
  } catch (error) {
    log.push(label + " threw " + (error as Error).constructor.name);
  }
}
function quietly(change: () => void) {
  try {
    change();
  } catch {}
}
for (let round = 0; round < 3; round++) {
  log.length = 0;
  tell("a buffer", () => Buffer.from("abc"));
  tell("an empty buffer", () => Buffer.alloc(0));
  tell("a large buffer", () => Buffer.alloc(70000));
  tell("a slice", () => Buffer.from("abcdef").subarray(2, 5));
  tell("of a pool", () => Buffer.allocUnsafe(9));
  tell("a length of its own", () => Object.defineProperty(Buffer.from("abc"), "length", { value: 0 }));
  tell("a getter of its own", () => Object.defineProperty(Buffer.from("abc"), "length", { get: () => 11 }));
  tell("another name of its own", () => Object.assign(Buffer.from("abc"), { extra: 1 }));
  tell("below a plain view's prototype", () => Object.setPrototypeOf(Buffer.from("abc"), Uint8Array.prototype));
  tell("below an object with a length", () => Object.setPrototypeOf(Buffer.from("abc"), { length: 0 }));
  tell("below nothing", () => Object.setPrototypeOf(Buffer.from("abc"), null));
  tell("below an heir of its prototype", () => Object.setPrototypeOf(Buffer.from("abc"), Object.create(Buffer.prototype, { length: { value: 21 } })));
  class Frame extends Buffer {
    get length() {
      return 31;
    }
  }
  tell("of a class below", () => Object.setPrototypeOf(Buffer.from("abc"), Frame.prototype));
  tell("over memory that can grow", () => Buffer.from(new ArrayBuffer(4, { maxByteLength: 16 })));
  tell("over memory that grew", () => {
    const memory = new ArrayBuffer(4, { maxByteLength: 16 });
    const over = Buffer.from(memory);
    memory.resize(12);
    return over;
  });
  tell("over memory that was handed on", () => {
    const memory = new ArrayBuffer(8);
    const over = Buffer.from(memory);
    memory.transfer();
    return over;
  });
  tell("frozen and empty", () => Object.freeze(Buffer.alloc(0)));
  tell("a plain view", () => new Uint8Array(3));
  tell("a view of doubles", () => new Float64Array(2));
  tell("a data view", () => new DataView(new ArrayBuffer(4)));

  tell("an arrow of two", () => (a: unknown, b: unknown) => [a, b]);
  tell("an arrow of none", () => () => 1);
  tell("a function of three", () => function (a: unknown, b: unknown, c: unknown) { return [a, b, c]; });
  tell("a default ends the count", () => (a: unknown, b = 1, c?: unknown) => [a, b, c]);
  tell("a rest does not count", () => (a: unknown, ...rest: unknown[]) => [a, rest]);
  tell("an async arrow", () => async (a: unknown) => a);
  tell("a generator function", () => function* (a: unknown, b: unknown) { yield [a, b]; });
  tell("a method", () => ({ method(a: unknown) { return a; } }).method);
  tell("a class", () => class { constructor(a: unknown, b: unknown) { log.length += Number(a === b) * 0; } });
  tell("a bound function", () => ((a: unknown, b: unknown, c: unknown) => [a, b, c]).bind(null, 1));
  tell("a native function", () => Math.max);
  tell("a function of the library", () => Buffer.from);
  tell("a length defined on it", () => Object.defineProperty((a: unknown, b: unknown) => [a, b], "length", { value: 0 }));
  tell("a length deleted", () => { const made = (a: unknown, b: unknown) => [a, b]; delete (made as any).length; return made; });
  tell("another name on it", () => Object.assign((a: unknown, b: unknown) => [a, b], { extra: 1 }));
  tell("below another prototype", () => Object.setPrototypeOf((a: unknown) => a, { length: 41 }));
  tell("deleted below another prototype", () => { const made = Object.setPrototypeOf((a: unknown) => a, { length: 41 }); delete made.length; return made; });
  tell("behind a proxy", () => new Proxy((a: unknown, b: unknown) => [a, b], { get: (target, key) => (key === "length" ? 51 : Reflect.get(target, key)) }));
  tell("of many parameters", () => new Function(...Array.from({ length: 300 }, (_, index) => "p" + index), "return 1"));

  tell("an object with a length", () => ({ length: 0 }));
  tell("no length", () => ({}));
  tell("a number", () => 5);
  tell("undefined", () => undefined);
}
quietly(() => Object.defineProperty(Buffer.prototype, "length", { get: () => 61, configurable: true }));
log.push("after a write on the prototype of buffers was tried, which an executable refuses, the reader says what a look says: " + (lengthOf(Buffer.from("abc")) === Reflect.get(Buffer.from("abc"), "length")));
console.log(log.join("\n"));
