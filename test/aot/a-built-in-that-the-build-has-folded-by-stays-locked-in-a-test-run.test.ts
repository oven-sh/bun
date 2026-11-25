// In a test run a built-in method is looked up where it is called, so that a test can replace it, and the engine opens whatever it follows a store to. A few lookups the build leaves out all the same:
// TypeScript keeps `#count` of an older target in `new WeakMap()`, and the build moves it into a field of the object, as it does in the executable, unless a file of the tests spells a store to
// `WeakMap.prototype.get`. A test that laid one where the build could not read the name got it onto the prototype, and the code under test never called it: "1 2 4" under `bun test`, "1 2 0" compiled.
// Whoever folds by a member now says so, and the member stays locked in that run: the store throws, names the member and says what to write instead.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const helpers = `
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
`;
const withPrivateState = `${helpers}
var _Counter_count;
export class Counter {
    constructor() { _Counter_count.set(this, 0); }
    bump() { __classPrivateFieldSet(this, _Counter_count, __classPrivateFieldGet(this, _Counter_count, "f") + 1, "f"); return __classPrivateFieldGet(this, _Counter_count, "f"); }
}
_Counter_count = new WeakMap();
`;
const withBrand = `${helpers}
var _Counter_instances, _Counter_step;
export class Counter {
    constructor() { _Counter_instances.add(this); this.count = 0; }
    bump() { return __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_step).call(this); }
}
_Counter_instances = new WeakSet(), _Counter_step = function _Counter_step() { return ++this.count; };
`;
const withSymbolKey = `
const kCount = Symbol("count");
export class Counter {
    constructor() { this[kCount] = 0; }
    bump() { return ++this[kCount]; }
}
`;
const withAccessorOnPrototype = `
export function Counter() { this.count = 0; }
Object.defineProperty(Counter.prototype, "next", { get() { return ++this.count; }, configurable: true });
Object.defineProperties(Counter.prototype, { bump: { value() { return mark(this).next; }, configurable: true, writable: true } });
function mark(counter) {
  Object.defineProperty(counter, "seen", { value: true, configurable: true });
  return Object.defineProperties(counter, { more: { value: true, configurable: true } });
}
`;
const withCollectionOfItsOwn = `
const counts = new WeakMap();
export class Counter {
    constructor() { counts.set(this, 0); }
    bump() { counts.set(this, counts.get(this) + 1); return counts.get(this); }
}
`;

const refusal = (member: string, holder: string, name: string) =>
  new RegExp(
    `Cannot assign to ${member} because built-in objects are read-only in compiled code, and the build didn't see a test replace this one\\. Spell out the object and the name where the test does it, as in ${member} = f or spyOn\\(${holder}, "${name}"\\)`.replaceAll(
      ".prototype",
      "\\.prototype",
    ),
  );

type Case = { product: string; holder: string; name: string; plain: string; compiled?: RegExp; madeFirst?: boolean };
const unspelled = (constructor: string) => `globalThis[JSON.parse('"${constructor}"')].prototype`;
const cases: Record<string, Case> = {
  "get of WeakMap, by a name that the build cannot read": {
    product: withPrivateState,
    holder: unspelled("WeakMap"),
    name: "get",
    plain: "1 2 4",
    compiled: refusal("WeakMap.prototype.get", "WeakMap.prototype", "get"),
  },
  // The entry of an object that is there already lies in its field.
  "set of WeakMap, by a name that the build cannot read, behind the first object": {
    product: withPrivateState,
    holder: unspelled("WeakMap"),
    name: "set",
    plain: "1 2 2",
    compiled: refusal("WeakMap.prototype.set", "WeakMap.prototype", "set"),
    madeFirst: true,
  },
  "has of WeakMap, by way of an instance": {
    product: withPrivateState,
    holder: `Object.getPrototypeOf(new (globalThis[JSON.parse('"WeakMap"')])())`,
    name: "has",
    plain: "1 2 6",
    compiled: refusal("WeakMap.prototype.has", "WeakMap.prototype", "has"),
  },
  "has of WeakSet, by a name that the build cannot read": {
    product: withBrand,
    holder: unspelled("WeakSet"),
    name: "has",
    plain: "1 2 2",
    compiled: refusal("WeakSet.prototype.has", "WeakSet.prototype", "has"),
  },
  // Where an entry is made the method is looked up and held against the original: what a replacement is handed stays in the collection, and whoever asks for it later asks the collection.
  "add of WeakSet, by a name that the build cannot read": {
    product: withBrand,
    holder: unspelled("WeakSet"),
    name: "add",
    plain: "1 2 1",
  },
  // Spelled, the build reads it: every entry stays in its collection, and the test sees each call.
  "get of WeakMap, spelled": { product: withPrivateState, holder: "WeakMap.prototype", name: "get", plain: "1 2 4" },
  // Nothing has been folded by the member, so the engine opens what it follows the store to, as before.
  "get of WeakMap where no state has moved": {
    product: withCollectionOfItsOwn,
    holder: unspelled("WeakMap"),
    name: "get",
    plain: "1 2 4",
  },
  // `const kCount = Symbol("count")` at the top of a module is a key that is made once, and `this[kCount]` is a field of the object: in the library's files and in the program's.
  "Symbol, by a road that the build cannot read": {
    product: withSymbolKey,
    holder: `globalThis[JSON.parse('"globalThis"')]`,
    name: "Symbol",
    plain: "1 2 0",
    compiled:
      /Cannot assign to Symbol because built-in objects are read-only in compiled code, and the build didn't see a test replace this one\. Spell out the object and the name where the test does it, as in globalThis\.Symbol = f or spyOn\(globalThis, "Symbol"\)/,
  },
  "Symbol, spelled": { product: withSymbolKey, holder: "globalThis", name: "Symbol", plain: "1 2 0" },
  "for of Symbol, by a name that the build cannot read": {
    product: withSymbolKey,
    holder: `globalThis[JSON.parse('"Symbol"')]`,
    name: "for",
    plain: "1 2 0",
    compiled: refusal("Symbol.for", "Symbol", "for"),
  },
  // The build sees an accessor that a file lays on a prototype where the callee is the built-in itself: in the library's files and in the program's.
  "defineProperty of Object, by a name that the build cannot read": {
    product: withAccessorOnPrototype,
    holder: `globalThis[JSON.parse('"Object"')]`,
    name: "defineProperty",
    plain: "1 2 2",
    compiled: refusal("Object.defineProperty", "Object", "defineProperty"),
  },
  "defineProperties of Object, by a name that the build cannot read": {
    product: withAccessorOnPrototype,
    holder: `globalThis[JSON.parse('"Object"')]`,
    name: "defineProperties",
    plain: "1 2 2",
    compiled: refusal("Object.defineProperties", "Object", "defineProperties"),
  },
  "defineProperty of Object, spelled": {
    product: withAccessorOnPrototype,
    holder: "Object",
    name: "defineProperty",
    plain: "1 2 2",
  },
  "a method that nothing is folded by, beside a state that has moved": {
    product: withPrivateState,
    holder: unspelled("WeakMap"),
    name: "delete",
    plain: "1 2 0",
  },
};

for (const [title, { product, holder, name, plain, compiled, madeFirst }] of Object.entries(cases))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-folded-by", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "product.js": product,
      "a.test.js": `import { test } from "bun:test";
import { Counter } from "./product.js";
test("t", () => {
  const holder = ${holder}, kept = holder.${name}, first = ${madeFirst ? "new Counter()" : "undefined"};
  let calls = 0;
  holder.${name} = function (...given) { calls++; return kept.apply(this, given); };
  try {
    const counter = first ?? new Counter();
    console.error("SEEN " + counter.bump() + " " + counter.bump() + " " + calls);
  } finally { holder.${name} = kept; }
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")),
        refused: compiled !== undefined && lines.some(line => compiled.test(line)),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: ["SEEN " + plain], refused: false, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({
      seen: compiled ? [] : ["SEEN " + plain],
      refused: compiled !== undefined,
      exitCode: compiled ? 1 : 0,
    });
  });
