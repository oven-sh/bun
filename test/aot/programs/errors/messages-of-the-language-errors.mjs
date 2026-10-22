// The class and the message of the errors that the language itself throws, and of a few that built-ins throw: reads, stores, calls, `new`, iteration, destructuring, `in`, `instanceof`, classes, `super`, private names, variables, frozen objects, generators and module namespaces.
import * as self from "./messages-of-the-language-errors.mjs";
export const exported = 1;

// The engine rewrites some messages around the text of the failing expression. A compiled program has the message from before that step.
function withoutSourceText(message) {
  return message
    .replace(/^(.*) is not a function\. \(In '.*', '.*' is (an instance of )?(.*)\)$/s, "$3 is not a function")
    .replace(/ \((evaluating|near) '.*'\)$/s, "")
    .replace(/^Symbol\(.*\) is not a function$/s, "a Symbol is not a function")
    .replace(/^.* is not an Object\.$/s, "(operand) is not an Object.")
    .replace(/^.*( is not a function\.|  is not a function)$/s, "(operand) is not a function.")
    .replace(/^.*\[Symbol\.hasInstance\] is not a function, undefined, or null\.?$/s, "(operand)[Symbol.hasInstance] is not a function, undefined, or null.")
    .replace(/^.* is not an object or null$/s, "The value of the superclass's prototype property is not an object or null.");
}

function attempt(label, run) {
  try {
    console.log(label, "->", String(run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, withoutSourceText(String(error?.message)));
  }
}

const opaque = value => [value, 0][Number(process.argv.length > 100)];
const nothing = opaque(undefined), none = opaque(null), number = opaque(5), text = opaque("abc"), plain = opaque({}), list = opaque([1, 2]);

for (const [name, value] of [["undefined", nothing], ["null", none]]) {
  attempt(name + ".a", () => value.a);
  attempt(name + "[key]", () => value[opaque("a")]);
  attempt(name + "[0]", () => value[opaque(0)]);
  attempt(name + "[symbol]", () => value[Symbol.iterator]);
  attempt(name + ".a = 1", () => (value.a = 1));
  attempt(name + "[key] = 1", () => (value[opaque("a")] = 1));
  attempt(name + ".a()", () => value.a());
  attempt("delete " + name + ".a", () => delete value.a);
  attempt("for of " + name, () => { for (const x of value) return x; });
  attempt("[..." + name + "]", () => [...value]);
  attempt("f(..." + name + ")", () => Math.max(...value));
  attempt("[a] = " + name, () => { const [a] = value; return a; });
  attempt("{a} = " + name, () => { const { a } = value; return a; });
  attempt("{} = " + name, () => { const {} = value; return 1; });
  attempt("{...rest} = " + name, () => { const { ...rest } = value; return rest; });
  attempt("'a' in " + name, () => "a" in value);
  attempt("x instanceof " + name, () => plain instanceof value);
  attempt("new " + name, () => new value());
  attempt(name + "()", () => value());
  attempt("class extends " + name, () => typeof class extends value {});
  attempt("yield* " + name, () => [...(function* () { yield* value; })()]);
  attempt("with template " + name, () => value`x`);
}

for (const [name, value] of [["5", number], ["'abc'", text], ["{}", plain], ["[1, 2]", list], ["true", opaque(true)], ["symbol", opaque(Symbol("s"))], ["10n", opaque(10n)]]) {
  attempt(name + "()", () => value());
  attempt(name + ".missing()", () => value.missing());
  attempt(name + "[key]()", () => value[opaque("missing")]());
  attempt("new " + name, () => new value());
  attempt("for of " + name, () => { for (const x of value) return String(x); });
  attempt("[..." + name + "]", () => [...value].length);
  attempt("[a] = " + name, () => { const [a] = value; return String(a); });
  attempt("'a' in " + name, () => "a" in value);
  attempt("x instanceof " + name, () => plain instanceof value);
  attempt("class extends " + name, () => class extends value {});
}

attempt("new arrow", () => new (opaque(() => 1))());
attempt("new method", () => new (opaque({ m() {} }).m)());
attempt("new Math.max", () => new (opaque(Math.max))());
attempt("new async function", () => new (opaque(async function () {}))());
attempt("instanceof with hasInstance 5", () => plain instanceof opaque({ [Symbol.hasInstance]: 5 }));
attempt("instanceof arrow", () => plain instanceof opaque(() => 1));
attempt("instanceof function with prototype 5", () => { function F() {} F.prototype = 5; return plain instanceof opaque(F); });

function Parent() {}
Parent.prototype = 5;
attempt("class extends function with prototype 5", () => class extends opaque(Parent) {});
attempt("class called without new", () => opaque(class Named {})());
attempt("anonymous class called without new", () => opaque(class {})());
attempt("this before super", () => new (class extends Object { constructor() { this.a = 1; super(); } })());
attempt("no super", () => new (class extends Object { constructor() {} })());
attempt("super twice", () => new (class extends Object { constructor() { super(); super(); } })());
attempt("super() of an arrow", () => { class A extends Object { constructor() { super(); } } Object.setPrototypeOf(A, opaque(() => 1)); return new A(); });
attempt("super() of null", () => { class A extends Object { constructor() { super(); } } Object.setPrototypeOf(A, none); return new A(); });
attempt("derived returns 5", () => new (class Derived extends Object { constructor() { super(); return opaque(5); } })());
attempt("anonymous derived returns 5", () => new (class extends Object { constructor() { super(); return opaque(5); } })());
attempt("delete super.a", () => new (class extends Object { m() { delete super.a; } })().m());
attempt("super.a with a null prototype", () => { const o = { __proto__: null, m() { return super.a; } }; return o.m(); });
attempt("super.a() missing", () => new (class extends Object { m() { return super.missing(); } })().m());
attempt("static computed prototype", () => class { static [opaque("prototype")] = 1; });

class Private {
  #field = 1;
  #method() {}
  get #getterOnly() { return 1; }
  set #setterOnly(value) {}
  static #staticMethod() {}
  static readField(o) { return o.#field; }
  static writeField(o) { o.#field = 2; }
  static callMethod(o) { return o.#method(); }
  static writeMethod(o) { o.#method = 1; }
  static writeGetterOnly(o) { o.#getterOnly = 1; }
  static readSetterOnly(o) { return o.#setterOnly; }
  static has(o) { return #field in o; }
  static callStatic(o) { return o.#staticMethod(); }
}
attempt("#field of {}", () => Private.readField(plain));
attempt("#field = of {}", () => Private.writeField(plain));
attempt("#method of {}", () => Private.callMethod(plain));
attempt("#method = ", () => Private.writeMethod(new Private()));
attempt("#getterOnly = ", () => Private.writeGetterOnly(new Private()));
attempt("#setterOnly read", () => Private.readSetterOnly(new Private()));
attempt("#field in 5", () => Private.has(number));
attempt("#staticMethod of {}", () => Private.callStatic(plain));
attempt("#staticMethod of 5", () => Private.callStatic(number));
attempt("#field defined twice", () => {
  class Base { constructor(o) { return o; } }
  class Stamper extends Base { #stamp = 1; }
  const o = {};
  new Stamper(o);
  new Stamper(o);
});
attempt("#method installed twice", () => {
  class Base { constructor(o) { return o; } }
  class Stamper extends Base { #stamp() {} }
  const o = {};
  new Stamper(o);
  new Stamper(o);
});

attempt("let before initialization", () => { const read = () => later; read(); let later = 1; });
attempt("missing variable", () => missingVariable);
attempt("typeof missing variable", () => typeof missingVariable);
attempt("missing variable = 1", () => { "use strict"; missingVariable = 1; });
attempt("import = 1", () => { self.exported = 2; });
attempt("frozen.a = 1", () => { Object.freeze(plain).a = 1; });
attempt("delete frozen[0]", () => delete Object.freeze([1])[0]);

const badIterators = {
  "iterator 5": { [Symbol.iterator]: 5 },
  "next missing": { [Symbol.iterator]() { return {}; } },
  "next returns 5": { [Symbol.iterator]() { return { next() { return 5; } }; } },
  "return 5": { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return: 5 }; } },
  "return returns 5": { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { return 5; } }; } },
};
for (const name in badIterators) {
  const iterable = opaque(badIterators[name]);
  attempt("for of, " + name, () => { for (const x of iterable) break; return "done"; });
  attempt("[a] =, " + name, () => { const [a] = iterable; return "done"; });
  attempt("[...], " + name, () => { if (name.startsWith("return")) return "skipped"; return [...iterable].length; });
  attempt("f(...), " + name, () => { if (name.startsWith("return")) return "skipped"; return Math.max(...iterable); });
  attempt("yield*, " + name, () => { if (name === "iterator 5") return "skipped"; for (const x of (function* () { yield* iterable; })()) break; return "done"; });
}
attempt("yield* without throw", () => {
  const inner = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; } }; } };
  const outer = (function* () { yield* inner; })();
  outer.next();
  outer.throw(new Error("x"));
});

attempt("generator running", () => { const g = (function* () { g.next(); })(); g.next(); });
attempt("generator next on {}", () => (function* () {})().next.call(plain));
attempt("replaceAll with /a/", () => text.replaceAll(opaque(/a/), "b"));
attempt("apply with 5", () => Math.max.apply(null, number));
attempt("Reflect.apply with 5", () => Reflect.apply(Math.max, null, number));
attempt("defineProperty getter 5", () => Object.defineProperty({}, "a", opaque({ get: 5 })));
attempt("defineProperty setter 5", () => Object.defineProperty({}, "a", opaque({ set: 5 })));
attempt("defineProperty on 5", () => Object.defineProperty(number, "a", {}));
attempt("defineProperty with 5", () => Object.defineProperty({}, "a", number));
attempt("namespace to accessor", () => Object.defineProperty(self, "exported", { get() {} }));
attempt("namespace to read-only", () => Object.defineProperty(self, "exported", { writable: false }));
attempt("namespace to hidden", () => Object.defineProperty(self, "exported", { enumerable: false }));
attempt("namespace to configurable", () => Object.defineProperty(self, "exported", { configurable: true }));
attempt("namespace to another value", () => Object.defineProperty(self, "exported", { value: 2 }));
attempt("namespace new name", () => Object.defineProperty(self, "other", { value: 2 }));
attempt("Uint8Array past the buffer", () => new Uint8Array(new ArrayBuffer(4), 0, opaque(8)));
attempt("Uint32Array at offset 1", () => new Uint32Array(new ArrayBuffer(8), opaque(1)));
attempt("new Array(-1)", () => new Array(opaque(-1)));
attempt("[].length = -1", () => { list.length = opaque(-1); });
attempt("deep recursion", () => { const f = n => f(n + 1) + 1; return f(0); });
attempt("1n + 1", () => opaque(1n) + number);
attempt("Symbol() + ''", () => opaque(Symbol("s")) + "");
attempt("setPrototypeOf cycle", () => { const a = {}, b = { __proto__: a }; Object.setPrototypeOf(a, b); });
attempt("__proto__ of non-extensible", () => { Object.preventExtensions(opaque({})).__proto__ = {}; });
