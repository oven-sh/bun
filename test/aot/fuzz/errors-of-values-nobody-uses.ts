// Operations that throw, written where nobody uses what they would have answered: the error still has to come, at its place among what happens before and behind it, and only if the operation is reached.
//
//   operations  repeat, fromCodePoint, normalize; big integers divided by zero, raised too far, mixed with numbers, made of fractions and of texts;
//               arrays, buffers and views of impossible lengths, offsets and indices; digits and radixes out of range; members of null and undefined, a variable before its declaration, getters and proxies that throw;
//               in and instanceof of what is no object, calls and `new` of what is no function, symbols turned into texts and numbers, what cannot be iterated taken apart or spread;
//               dates, texts of JSON, URIs, patterns, collections and other parts of the library handed what they refuse
//   operands    written there, a parameter with a type, or a value of which the program's text says nothing
//   unused as   a statement, under void, a constant nobody reads, a variable overwritten at once, the left side of a comma, an element of a list of which the length is read, a member of an object of which another is read,
//               the operand of typeof, a condition with the same answer both ways, the result of a function, an arrow or a method called for nothing, an argument nobody looks at, a default nobody needs
//   around it   a note in front and a note behind; a loop that runs three times, once or never; a second operation that throws behind the first; a branch that is not taken; finally
//
// Each scene prints its notes and the name of the error.
import type { Random } from "./random";

// No operation here fails for want of memory: an allocation that nobody uses need not happen. `S` a short text, `N` null, `U` undefined, `B` a big integer, `Z` zero as a big integer, `I` a number, `Y` a symbol, `A` a list, `O` an object, `V` a view of eight bytes.
const operations: string[] = [
  "S.repeat(-1)", "S.repeat(Infinity)", "S.repeat(I - 100)", "String.fromCodePoint(-1)", "String.fromCodePoint(1.5)", "String.fromCodePoint(0x110000 + I)", 'S.normalize("no")', "S.at.call(N, 0)", "S.matchAll(/a/)", 'S.replaceAll(/a/, "")', "S.startsWith(/a/ as any)", "S.includes(/a/ as any)", "S.localeCompare(S, \"x-\")",
  "B / Z", "B % Z", "B ** -B", "B ** (2n ** 64n)", "B << (B ** 40n)", "(B as any) + I", "(B as any) * I", "I - (B as any)", "+(B as any)", "Math.max(B as any)", "Math.abs(B as any)", "BigInt(1.5)", "BigInt(I + 0.5)", "BigInt(S)", "BigInt(U as any)", "BigInt(NaN)", "BigInt.asUintN(-1, B)", "BigInt.asIntN(2 ** 53, B)", "(B as any) >>> (Z as any)", "BigInt(Y as any)",
  "new Array(-1)", "new Array(I - 100)", "new Array(2 ** 32)", "Array(1.5)", "new Array(I + 0.5)", "new ArrayBuffer(-1)", "new ArrayBuffer(2 ** 53)", "new Uint8Array(-1)", "new Uint8Array(I - 100)", "new Uint16Array(V.buffer, 1)", "new Uint32Array(V.buffer, 4, 2)", "new Float64Array(V.buffer, 16)", "new DataView(V.buffer, 9)", "new DataView(V.buffer).getInt8(8)", "new DataView(V.buffer).getFloat64(1)", "new DataView(V.buffer).getInt16(-1)",
  "Array.from({ length: 2 ** 53 })", "Array.from({ length: Infinity })", "([] as number[]).reduce((a, b) => a + b)", "([] as number[]).reduceRight((a, b) => a + b)", "A.with(99, 0)", "A.with(-99, 0)", "V.with(8, 0)", "A.toSpliced(0, 0, ...A).with(I + 100, 0)", "A.flatMap(1 as any)", "A.map(U as any)", "A.sort(1 as any)", "A.toSorted(S as any)", "V.subarray.call(A as any, 0)", "V.set([1], 8)", "V.set(A, 7)", "new Uint8Array(V.buffer.slice(0), 0, 9)", "A.at.call(N, 0)", "Array.prototype.concat.call(U, A)", "A.findLast(N as any)", "A.every(1 as any)",
  "(I).toFixed(101)", "(I).toFixed(-1)", "(I).toPrecision(0)", "(I).toPrecision(101)", "(I).toString(1)", "(I).toString(37)", "(I).toExponential(-1)", "(I).toExponential(101)", "Number.prototype.toString.call(S)", "Number.prototype.valueOf.call(O)", "B.toString(1)", "(I).toLocaleString(\"x-\")",
  "N.x", "U.x", "N[0]", "U[S]", "N.x.y", "O.none.x", "O.none[I]", "O.none()", "O.none?.x.y.z", "N?.x.y ?? U.x", "O.thrower", "O.inner.thrower", "O.proxy.anything", "O.proxy[I]", "readsLate()", "typeof readsLate()", "readsLate() + 1",
  "S in (I as any)", "S in (S as any)", "I in N", "O instanceof (I as any)", "O instanceof (O as any)", "O instanceof (N as any)", "O instanceof (() => {})", "new (I as any)()", "new (O as any)()", "new (Math.max as any)()", "new ((() => {}) as any)()", "(I as any)()", "(S as any)()", "(N as any)()", "(O as any)()", "O.inner()", "(A as any)[99]()", "new (class { constructor() { throw new EvalError(S); } })()", "(class {} as any)()", "Symbol.prototype.toString.call(S)",
  'Y + ""', '"" + Y', "`${Y}`", "+Y", "Y * 1", "Y - I", "Y < I", "Math.floor(Y)", "[Y].join()", "S.concat(Y)", "Number(Y)", "parseInt(Y)", "isNaN(Y)", "new Date(Y)", "S + O.noPrimitive", "+O.noPrimitive", "`${O.noPrimitive}`", "O.noPrimitive < 1", "O.noPrimitive == 1", "[O.noPrimitive] + S", "O[O.noPrimitive]", "S.indexOf(O.noPrimitive)", "A.join(O.noPrimitive)", "Math.max(I, O.noPrimitive)", "A[O.throwsAsKey]", "S.charAt(O.throwsAsNumber)", "I ** O.throwsAsNumber", "I | O.throwsAsNumber", "A.slice(O.throwsAsNumber)", "new Array(O.throwsAsNumber)",
  "[...N]", "[...U]", "[...(I as any)]", "[...(O as any)]", "Math.max(...N)", "new Set(I as any)", "new Map([I] as any)", "new Map(I as any)", "new WeakSet([I] as any)", "Object.fromEntries(I as any)", "Object.fromEntries([I] as any)", "Array.from(O.badIterator)", "[...O.badIterator]", "new Set(O.throwingIterator)", "Promise.all.call(I, [])", "Object.groupBy(N, () => S)", "Iterator.from(I as any)", "Array.from(A, I as any)",
  "new Date(NaN).toISOString()", "new Date(8.64e15 + 1).toISOString()", "new Date(NaN).toJSON.call(N)", 'JSON.parse("{")', 'JSON.parse("")', "JSON.parse(S + S)", "JSON.parse(U as any)", "JSON.stringify(O.cycle)", "JSON.stringify(B)", "JSON.stringify({ a: [B] })", "JSON.stringify(O.proxy)", 'decodeURIComponent("%")', 'decodeURI("%E0%A4%A")', 'encodeURIComponent("\\ud800")', 'encodeURI("\\udc00" + S)', 'new RegExp("(")', 'new RegExp("[b-a]")', 'new RegExp(S, "gg")', 'new RegExp("\\\\", "u")', "RegExp.prototype.exec.call(O, S)", "RegExp.prototype.test.call(I, S)", "/a/.exec(Y)",
  "new WeakMap().set(I as any, 1)", "new WeakSet().add(S as any)", "new WeakRef(I as any)", "new WeakMap([[I, 1]] as any)", "Map.prototype.get.call(O, 1)", "Set.prototype.has.call(new Map(), 1)", "Map.prototype.size", "new Proxy(I as any, {})", "new Proxy({}, N)", "Proxy.revocable(N, {})", "Reflect.ownKeys(I as any)", "Reflect.get(S as any, S)", "Reflect.has(I as any, S)", "Reflect.getPrototypeOf(I as any)", "Reflect.apply(I as any, N, [])", "Reflect.apply(Math.max, N, I as any)", "Reflect.construct(Math.max, [])", "Reflect.construct(Object, [], I as any)",
  "Object.defineProperty(I as any, S, {})", "Object.defineProperty({}, S, I as any)", "Object.defineProperty({}, S, { get: I as any })", "Object.defineProperty({}, S, { get() {}, value: 1 })", "Object.defineProperties({}, N)", "Object.create(I as any)", "Object.create(U as any)", "Object.setPrototypeOf(N, {})", "Object.setPrototypeOf({}, I as any)", "Object.setPrototypeOf(Object.freeze({}), {})", "Object.assign(N, {})", "Object.keys(N)", "Object.entries(U)", "Object.values(N)", "Object.getOwnPropertyNames(U)", "Object.getPrototypeOf(N)", "Object.fromEntries(N)", "Object.hasOwn(N, S)", "Object.prototype.hasOwnProperty.call(N, S)", "Object.prototype.toLocaleString.call(N)", "Object.prototype.valueOf.call(U)", "Object.prototype.isPrototypeOf.call(N, O)", "Object.prototype.propertyIsEnumerable.call(U, S)",
  "Symbol.keyFor(S as any)", "new (Symbol as any)()", "Symbol.prototype.description", "Symbol.prototype.valueOf.call(S)", "new Promise(I as any)", "new (Promise as any)()", "(Promise as any)(() => {})", "Promise.resolve.call(I, 1)", "Promise.prototype.then.call(O, N, N)", "Promise.withResolvers.call(I)", "(Function.prototype.call as any).call(I)", "Function.prototype.apply.call(Math.max, N, I)", "(Function.prototype.bind as any).call(O)", "Function.prototype.toString.call(O)", "Function.prototype[Symbol.hasInstance].call(I, O) || N.x", "new (function* () {} as any)()", "new ((async () => {}) as any)()", "(function* () {})().next.call(O)", "Date.prototype.getTime.call(O)", "Date.prototype[Symbol.toPrimitive].call(new Date(0), S)", "Boolean.prototype.valueOf.call(I)", "String.prototype.valueOf.call(I)", "BigInt.prototype.valueOf.call(I)", "Error.prototype.toString.call(I)", "ArrayBuffer.prototype.slice.call(O, 0)", "ArrayBuffer.prototype.byteLength", "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), \"length\")!.get!.call(A)", "Atomics.load(A as any, 0)", "Atomics.load(V, 8)", "Atomics.add(new Float64Array(1) as any, 0, 1)", "Atomics.notify(V as any, 0)", "Atomics.wait(new Int32Array(1), 0, 0, 0)",
  'new Intl.NumberFormat("x-")', 'new Intl.DateTimeFormat("en", { timeZone: S })', 'new Intl.NumberFormat("en", { style: "currency" })', 'new Intl.NumberFormat("en", { maximumFractionDigits: 101 })', "new Intl.DateTimeFormat().format(NaN as any)", 'new Intl.PluralRules("en", { type: S as any })', 'Intl.getCanonicalLocales("x-")', 'new Intl.Locale("")', "Intl.supportedValuesOf(S as any)", 'new Intl.Collator("en", { usage: S as any })',
  "structuredClone(() => {})", "structuredClone(Y)", "structuredClone(O.proxy)", 'atob("*")', 'btoa("\\u0100")', "new URL(S)", 'new URL("/", S)', 'new TextDecoder("no")', 'new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([255]))', "new TextEncoder().encodeInto(S, A as any)", "new Blob(I as any)", "new Headers([[S]] as any)", 'new Headers({ "a b": S })', "new Response(S, { status: 99 })", 'new Request(S)', "new AbortController().signal.throwIfAborted.call(O)", "AbortSignal.abort(new EvalError(S)).throwIfAborted()", "AbortSignal.timeout(-1)", "queueMicrotask(I as any)", "new (Event as any)()", "new EventTarget().dispatchEvent(O as any)", "crypto.getRandomValues(new Float64Array(1) as any)", "crypto.getRandomValues(new Uint8Array(65537))", "performance.measure(S, S + S)", "new URLSearchParams([[S]] as any)", "Buffer.alloc(-1)", "Buffer.from(I as any)", "Buffer.alloc(1).readUInt8(1)", "Buffer.alloc(1).readInt32LE(0)", "Buffer.alloc(4).toString(S as any)", "Buffer.concat(I as any)", "Buffer.byteLength(I as any)",
];

// `E` the operation.
const places: [string, string][] = [
  ["statement", "E;"],
  ["void", "void E;"],
  ["void-used", "note(String(void E));"],
  ["constant", "const unused = E;"],
  ["overwritten", "let value: unknown = E;\n    value = 1;\n    note(String(value));"],
  ["comma", "note(String((E, 1)));"],
  ["length-of-a-list", "note(String([E, 2].length));"],
  ["other-element", "note(String([E, 2][1]));"],
  ["other-member", "note(String({ a: E, b: 2 }.b));"],
  ["typeof", "note((typeof E).length > 0 ? \"t\" : \"f\");"],
  ["both-ways", "note((E as unknown) ? \"same\" : \"same\");"],
  ["or-true", "if ((E as unknown) || true) note(\"in\");"],
  ["and-false", "if ((E as unknown) && false) note(\"never\");"],
  ["not-not", "!!(E as unknown);"],
  ["equal-to-itself", "const twice = E;\n    note(String(twice === twice || true));"],
  ["result-of-a-function", "function made() {\n      return E;\n    }\n    made();"],
  ["result-of-an-arrow", "const made = () => E;\n    made();"],
  ["arrow-at-once", "(() => E)();"],
  ["arrow-body", "(() => {\n      E;\n    })();"],
  ["method", "({\n      made() {\n        return E;\n      },\n    }).made();"],
  ["getter", "({\n      get made() {\n        return E;\n      },\n    }).made;"],
  ["argument", "ignores(E);"],
  ["second-argument", "ignores(note(\"first\"), E, note(\"third\"));"],
  ["default", "((taken = E) => {})();"],
  ["default-not-needed", "((taken: unknown = E) => note(String(taken)))(1);"],
  ["template", "`${note(\"left\")}${E}${note(\"right\")}`;"],
  ["spread-into-nothing", "ignores(...[E]);"],
  ["pattern", "const [, second] = [E, 2];\n    note(String(second));"],
  ["member-pattern", "const { b: other }: { a: unknown; b: number } = { a: E, b: 2 };\n    note(String(other));"],
  ["key", "note(String(Object.keys({ [String(E)]: 1 }).length));"],
  ["class-field", "new (class {\n      field = E;\n    })();"],
  ["static-field", "(class {\n      static field = E;\n    });"],
  ["await", "ASYNC await E;"],
  ["promise", "ASYNC await Promise.resolve().then(() => E);"],
  ["generator", "[...(function* () {\n      yield 1;\n      E;\n      yield 2;\n    })()].length;"],
  ["switch", "switch (E) {\n      default:\n        note(\"default\");\n    }"],
  ["case", "switch (1 as unknown) {\n      case E:\n      default:\n        note(\"default\");\n    }"],
  ["delete", "delete ({ a: E } as { a?: unknown }).a;"],
  ["nullish", "note(String(three ?? E));"],
  ["not-reached-and", "note(String(off && (E as unknown)));"],
  ["not-reached-or", "note(String(on || (E as unknown)));"],
  ["not-reached-branch", "if (off) E;"],
  ["not-reached-choice", "note(String(on ? 1 : E));"],
  ["not-reached-optional", "given.missing?.member(E);"],
];

const surroundings: [string, string][] = [
  ["alone", "P"],
  ["notes", 'note("before");\n    P\n    note("behind");'],
  ["three-times", 'for (let i = 0; i < three; i++) {\n      note("turn" + i);\n      {\n    P\n      }\n    }'],
  ["never", 'for (let i = 0; i < zero; i++) {\n      {\n    P\n      }\n    }\n    note("no turn");'],
  ["never-while", 'let left = zero;\n    while (left-- > 0) {\n    P\n    }\n    note("no turn");'],
  ["last-turn", 'for (let i = 0; i < three; i++) {\n      note("turn" + i);\n      if (i === 2) {\n    P\n      }\n    }'],
  ["finally", 'try {\n      note("try");\n      {\n    P\n      }\n      note("behind");\n    } finally {\n      note("finally");\n    }'],
  ["in-finally", 'try {\n      note("try");\n    } finally {\n    P\n    }'],
  ["in-catch", 'try {\n      throw new URIError("first");\n    } catch {\n    P\n    }'],
  ["caught-inside", 'try {\n    P\n      note("behind");\n    } catch (inner) {\n      note("inner " + (inner as Error).name);\n    }\n    note("after");'],
  ["store-in-front", 'kept.value = 1;\n    {\n    P\n    }\n    kept.value = 2;'],
  ["store-in-a-list", 'list[0] = 1;\n    {\n    P\n    }\n    list[0] = 2;'],
  ["a-second-one", "P\n    Q"],
];

const prelude = `let notes: string[] = [];
function note(text: string): string {
  notes.push(text);
  return text;
}
function ignores(..._all: unknown[]): void {}
const given: any = JSON.parse('{"zero":0,"three":3,"on":true,"off":false,"number":7,"text":"ab","list":[1,2,3],"nothing":null}');
const kept = { value: 0 };
const list = [0];
const thing: any = {
  inner: {
    get thrower() {
      throw new EvalError("inner getter");
    },
  },
  get thrower() {
    throw new EvalError("getter");
  },
  proxy: new Proxy(
    {},
    {
      get() {
        throw new EvalError("get");
      },
      ownKeys() {
        throw new EvalError("ownKeys");
      },
    },
  ),
  noPrimitive: Object.create(null),
  throwsAsKey: {
    toString() {
      throw new EvalError("key");
    },
  },
  throwsAsNumber: {
    valueOf() {
      throw new EvalError("number");
    },
  },
  badIterator: { [Symbol.iterator]: 1 },
  throwingIterator: {
    [Symbol.iterator]() {
      return {
        next() {
          throw new EvalError("next");
        },
      };
    },
  },
};
thing.cycle = thing.inner;
thing.cycle = { self: null };
thing.cycle.self = thing.cycle;`;

export function generate(random: Random): string {
  const scenes: string[] = [];
  const heads: string[] = [];
  const count = random.between(14, 30);
  for (let at = 0; at < count; at++) {
    const how = random.pick(["written", "written", "typed", "opaque"] as const);
    let [placeName, place] = random.pick(places);
    const [aroundName, around] = random.pick(surroundings);
    const fill = (operation: string) => operation.replace(/\b([SNUBZIYAOV])\b/g, (_, letter: string) => names[letter]);
    const drawn = () => random.pick(operations);
    const written: Record<string, string> = { S: '"ab"', N: "(null as any)", U: "(undefined as any)", B: "7n", Z: "0n", I: "7", Y: "(Symbol() as any)", A: "[1, 2, 3]", O: "thing", V: "new Uint8Array(8)" };
    const parameters: Record<string, string> = { S: "s", N: "n", U: "u", B: "b", Z: "z", I: "i", Y: "y", A: "a", O: "o", V: "v" };
    const names = how === "written" ? written : parameters;
    const first = drawn(), second = drawn();
    // The checker refuses a comma whose left side plainly does nothing, and a test of what is plainly truthy.
    if ((placeName === "comma" && !/^[\w.]+\(/.test(first)) || (/as unknown\) (\?|\|\||&&)|^!!/.test(place) && /^(new |\[|`|\(class|\(function)/.test(first))) [placeName, place] = places[0];
    const isAsync = place.startsWith("ASYNC ");
    const body = around.replace("P", () => "    " + place.replace("ASYNC ", "").replace(/\bE\b/g, () => "(" + fill(first) + ")")).replace("Q", () => "(" + fill(second) + ");");
    const any = how === "opaque";
    const signature = how === "written" ? "" : any ? "s: any, n: any, u: any, b: any, z: any, i: any, y: any, a: any, o: any, v: any" : "s: string, n: any, u: any, b: bigint, z: bigint, i: number, y: any, a: number[], o: any, v: Uint8Array<ArrayBuffer>";
    const call = how === "written" ? "" : any ? "given.text, given.nothing, given.missing, BigInt(given.number), BigInt(given.zero), given.number, Symbol(), given.list.slice(), thing, new Uint8Array(8)" : '"ab", null, undefined, 7n, 0n, 7, Symbol(), [1, 2, 3], thing, new Uint8Array(8)';
    heads.push(`${placeName}/${aroundName}/${how}`);
    scenes.push(`${isAsync ? "async " : ""}function scene${at}(${signature}) {
  const zero: number = given.zero, three: number = given.three, on: boolean = given.on, off: boolean = given.off;
  {
${body}
  }
  let late = 1;
  function readsLate(): number {
    return late;
  }
  ignores(readsLate, zero, three, on, off);
}
notes = [];
kept.value = 0;
list[0] = 0;
try {
  ${isAsync ? "await " : ""}scene${at}(${call});
  note("no error");
} catch (error) {
  note(error instanceof Error ? error.name : String(error));
}
console.log("${at}: " + notes.join(" ") + " | " + kept.value + list[0]);`);
  }
  return `// ${heads.join(" ")}
${prelude}
${scenes.join("\n")}`;
}
