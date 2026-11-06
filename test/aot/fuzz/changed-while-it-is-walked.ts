// A loop or a built-in walks an array, a Map, a Set or an object, and at one step the program's own code changes the very thing that is walked.
//
//   things    arrays of integers, fractions, strings, objects, a mix, with holes; made by a literal, by push, by a length, backward, by slice, map, spread, from; in sparse storage; of a subclass; behind a Proxy;
//             Maps and Sets keyed by numbers, strings and objects; objects with values and accessors, made by a literal, name by name, by a class
//   walks     loops by index (the length read each time, once, backward), for-of, for-in, entries, keys, an iterator by hand, a generator, yield*, patterns, spreads, every method of Array that calls back, sort,
//             Array.from, JSON with toJSON, with a replacer and with a reviver, join and String over objects, arguments that convert (indexOf, fill, splice, slice, with, copyWithin, at, includes, lastIndexOf, flat, concat),
//             structuredClone, Object.keys | values | entries | assign, spreads and rest patterns over accessors, forEach and the iterators of Maps and Sets, loops with a wait at each step
//   changes   grows by one and by thousands, shrinks by one and to nothing, a length far out, shift, unshift, splice, a hole, another kind of element, an element far out, an accessor for an element, frozen, sealed,
//             another prototype with elements of its own, reversed, sorted, filled; cleared, deleted ahead, behind and here, deleted and added again; keys deleted, added, redefined, hidden; a throw; the same walk again inside
//   reached   written in the loop itself, through a function that takes the thing, through a closure that nobody can look through, by another job between two waits
//   behind    nothing, a collection, a collection and 400 new arrays of 1 to 40 elements
//
// Each walk prints what it saw, what the thing looks like behind it, and what the same walk sees the second time.
import type { Random } from "./random";

const prelude = `declare const Bun: { gc(full: boolean): unknown };
let step = 0;
let at = -1;
let depth = 0;
function idle(): void {}
let damage: () => void = idle;
function hit(): void {
  if (step++ === at) damage();
}
class Item {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
  toString(): string {
    hit();
    return "I" + this.v;
  }
  toJSON(): unknown {
    hit();
    return this.v;
  }
}
class Wider extends Item {
  w: string;
  constructor(v: number) {
    super(v);
    this.w = "w" + v;
  }
}
class List<T> extends Array<T> {}
type Mixed = number | string | Item | boolean | null | undefined;
function mixedOf(i: number): Mixed {
  switch (i % 7) {
    case 0:
      return i;
    case 1:
      return i + 0.5;
    case 2:
      return "m" + i;
    case 3:
      return new Item(i);
    case 4:
      return i % 2 === 0;
    case 5:
      return null;
    default:
      return undefined;
  }
}
function show(x: unknown): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "string") return x.length > 12 ? "'" + x.slice(0, 8) + ".." + x.length : "'" + x;
  if (x === undefined) return "u";
  if (x === null) return "null";
  if (typeof x === "bigint") return x + "n";
  if (typeof x !== "object") return typeof x === "boolean" ? String(x) : typeof x;
  if (x instanceof Item) return (x instanceof Wider ? "W" : "I") + x.v;
  if (Array.isArray(x)) return "[" + x.length + "]";
  return "object";
}
function describe(error: unknown): string {
  // The words of an engine's error name the source text, which a compiled program does not carry.
  return "threw " + (error instanceof Error ? (error.constructor === Error ? error.message : error.name) : show(error));
}
function brief(text: string): string {
  if (text.length <= 260) return text;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return text.slice(0, 160) + " .. " + text.length + " #" + hash;
}
function lookAtList(c: any): string {
  let all = "length " + c.length + ":";
  for (let i = 0; i < Math.min(c.length, 24); i++) all += " " + (i in c ? show(c[i]) : "-");
  const names = Object.getOwnPropertyNames(c);
  all += " names " + names.length + " " + names.slice(-2).join();
  return all + (Object.isFrozen(c) ? " frozen" : Object.isSealed(c) ? " sealed" : "") + (Object.getPrototypeOf(c) === Array.prototype ? "" : " another prototype");
}
function lookAtKeyed(c: any): string {
  let all = "size " + c.size + ":";
  let n = 0;
  for (const entry of c) if (n++ < 24) all += " " + (Array.isArray(entry) ? show(entry[0]) + "=" + show(entry[1]) : show(entry));
  return all;
}
function lookAtObject(c: any): string {
  const names = Reflect.ownKeys(c);
  let all = "names " + names.length + ":";
  for (const name of names.slice(0, 24)) {
    const d = Object.getOwnPropertyDescriptor(c, name)!;
    all += " " + String(name) + (d.enumerable ? "" : "(hidden)") + "=" + ("value" in d ? show(d.value) : "accessor");
  }
  return all + (Object.isFrozen(c) ? " frozen" : "") + (Object.getPrototypeOf(c) === Object.prototype ? "" : " another prototype");
}
const refilled: unknown[] = [];
function refill(): void {
  Bun.gc(true);
  for (let i = 0; i < 400; i++) {
    const size = (i % 40) + 1;
    refilled[i % 100] = i % 3 === 0 ? new Array<string>(size).fill("STALE") : i % 3 === 1 ? new Array<number>(size).fill(-7777) : new Array<number>(size).fill(-7777.25);
  }
}
function watched<T extends object>(inner: T): T {
  return new Proxy(inner, {
    get(target, key, receiver) {
      if (typeof key === "string" && key !== "length") hit();
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      hit();
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      hit();
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      hit();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}`;

type Kind = { name: string; type: string; element: (i: string) => string; others: string[]; isObject?: boolean; isNumber?: boolean };
const kinds: Kind[] = [
  { name: "integers", type: "number", element: i => `(${i} + 1)`, others: ["0.5", "-0", "NaN", "2147483648", "-2147483649", "1e300"], isNumber: true },
  { name: "fractions", type: "number", element: i => `(${i} + 0.5)`, others: ["3", "NaN", "-0", "Infinity"], isNumber: true },
  { name: "strings", type: "string", element: i => `("s" + ${i})`, others: ['("r" + step + "opes".repeat(3))', '""'] },
  { name: "objects", type: "Item", element: i => `new Item(${i})`, others: ["new Wider(step)"], isObject: true },
  { name: "mixed", type: "Mixed", element: i => `mixedOf(${i})`, others: ["null", "undefined", "1.5", '"other"', "new Wider(step)"] },
  { name: "optional", type: "(number | undefined)", element: i => `(${i} % 3 === 1 ? undefined : ${i})`, others: ["undefined", "0.5"] },
];
const lies = ['"lie"', "{}", "null", "undefined", "10n", "[1]", "true"];

// `E(i)` is the element at i, `N` the count, `T` the type of an element.
const listMakers: Record<string, string> = {
  pushed: "const c: T[] = [];\n  for (let i = 0; i < N; i++) c.push(E(i));\n  return c;",
  sized: "const c = new Array<T>(N);\n  for (let i = 0; i < N; i++) c[i] = E(i);\n  return c;",
  backward: "const c: T[] = [];\n  for (let i = N - 1; i >= 0; i--) c[i] = E(i);\n  return c;",
  from: "return Array.from({ length: N }, (_, i) => E(i));",
  sliced: "const c: T[] = [];\n  for (let i = -1; i <= N; i++) c.push(E(i));\n  return c.slice(1, N + 1);",
  mapped: "return new Array<number>(N).fill(0).map((_, i) => E(i));",
  spread: "const c: T[] = [];\n  for (let i = 0; i < N; i++) c.push(E(i));\n  return [...c];",
  "with-holes": "const c: T[] = [];\n  for (let i = 0; i < N; i++) if (i % 4 !== 2) c[i] = E(i);\n  c.length = N;\n  return c;",
  "sparse-storage": "const c: T[] = [];\n  for (let i = 0; i < N; i++) c.push(E(i));\n  c.length = 200000;\n  c.length = N;\n  return c;",
  subclass: "const c = new List<T>();\n  for (let i = 0; i < N; i++) c.push(E(i));\n  return c;",
  "with-a-name": "const c: T[] = [];\n  for (let i = 0; i < N; i++) c.push(E(i));\n  (c as any).tag = 1;\n  return c;",
  proxied: "const c: T[] = [];\n  for (let i = 0; i < N; i++) c.push(E(i));\n  return watched(c);",
};

type Walk = { text: string; needs?: "objects" | "numbers"; once?: boolean; isAsync?: boolean; helper?: string; inlineOnly?: boolean };
// `HIT` is where the change may come; `c` is the thing; `out` is what was seen.
const listWalks: Record<string, Walk> = {
  "by-index": { text: 'for (let i = 0; i < c.length; i++) {\n    HIT\n    out += show(c[i]) + " ";\n  }' },
  "by-index-length-once": { text: 'const n = c.length;\n  for (let i = 0; i < n; i++) {\n    HIT\n    out += show(c[i]) + " ";\n  }' },
  "by-index-read-first": { text: 'for (let i = 0; i < c.length; i++) {\n    const x = c[i];\n    HIT\n    out += show(x) + show(c[i]) + " ";\n  }' },
  backward: { text: 'for (let i = c.length - 1; i >= 0; i--) {\n    HIT\n    out += show(c[i]) + " ";\n  }' },
  "stores-by-index": { text: "const n = c.length;\n  for (let i = 0; i < n; i++) {\n    HIT\n    c[i] = FRESH(i);\n  }" },
  "copies-by-index": { text: 'for (let i = 1; i < c.length; i++) {\n    HIT\n    c[i - 1] = c[i];\n  }\n  out += c.length;' },
  "sums-by-index": { text: "let sum = 0;\n  for (let i = 0; i < c.length; i++) {\n    HIT\n    sum += c[i];\n  }\n  out += sum;", needs: "numbers" },
  "for-of": { text: 'for (const x of c) {\n    HIT\n    out += show(x) + " ";\n  }' },
  "for-of-hit-behind": { text: 'for (const x of c) {\n    out += show(x) + " ";\n    HIT\n  }' },
  entries: { text: 'for (const [i, x] of c.entries()) {\n    HIT\n    out += i + ":" + show(x) + " ";\n  }' },
  keys: { text: 'for (const i of c.keys()) {\n    HIT\n    out += i + ":" + show(c[i]) + " ";\n  }' },
  "for-in": { text: 'for (const i in c) {\n    HIT\n    out += i + ":" + show((c as any)[i]) + " ";\n  }' },
  "iterator-by-hand": { text: 'const it = c[Symbol.iterator]();\n  for (let r = it.next(); !r.done; r = it.next()) {\n    HIT\n    out += show(r.value) + " ";\n  }' },
  "for-each": { text: 'c.forEach((x, i) => {\n    HIT\n    out += i + ":" + show(x) + " ";\n  });' },
  map: { text: "out += c\n    .map((x, i) => {\n      HIT\n      return show(x) + i;\n    })\n    .join();" },
  filter: { text: "out += c\n    .filter((x, i) => {\n      HIT\n      return i % 2 === 0;\n    })\n    .map(show)\n    .join();" },
  some: { text: "out += c.some(x => {\n    HIT\n    out += show(x);\n    return false;\n  });" },
  every: { text: "out += c.every(x => {\n    HIT\n    out += show(x);\n    return true;\n  });" },
  find: { text: "out += show(\n    c.find(x => {\n      HIT\n      out += show(x);\n      return false;\n    }),\n  );" },
  "find-index": { text: "out += c.findIndex(x => {\n    HIT\n    out += show(x);\n    return false;\n  });" },
  "find-last": { text: "out += show(\n    c.findLast(x => {\n      HIT\n      out += show(x);\n      return false;\n    }),\n  );" },
  "find-last-index": { text: "out += c.findLastIndex(x => {\n    HIT\n    out += show(x);\n    return false;\n  });" },
  reduce: { text: 'out += c.reduce<string>((all, x, i) => {\n    HIT\n    return all + i + show(x);\n  }, "");' },
  "reduce-right": { text: 'out += c.reduceRight<string>((all, x, i) => {\n    HIT\n    return all + i + show(x);\n  }, "");' },
  "reduce-to-a-number": { text: "out += c.reduce((sum, x) => {\n    HIT\n    return sum + x;\n  }, 0);", needs: "numbers" },
  "flat-map": { text: "out += c\n    .flatMap((x, i) => {\n      HIT\n      return i % 2 ? [x] : [x, x];\n    })\n    .map(show)\n    .join();" },
  sort: { text: "c.sort((l, r) => {\n    HIT\n    return show(l) < show(r) ? 1 : show(l) > show(r) ? -1 : 0;\n  });\n  out += c.map(show).join();" },
  "to-sorted": { text: "out += c\n    .toSorted((l, r) => {\n      HIT\n      return show(l) < show(r) ? 1 : show(l) > show(r) ? -1 : 0;\n    })\n    .map(show)\n    .join();" },
  "array-from": { text: "out += Array.from(c, (x, i) => {\n    HIT\n    return show(x) + i;\n  }).join();" },
  "generator-spread": { helper: "for (const x of c) {\n    HIT\n    yield x;\n  }", text: "out += [...eachID(c)].map(show).join();" },
  "generator-by-index": { helper: "for (let i = 0; i < c.length; i++) {\n    HIT\n    yield c[i];\n  }", text: "out += [...eachID(c)].map(show).join();" },
  "consumer-of-a-generator": { helper: "for (const x of c) yield x;", text: 'for (const x of eachID(c)) {\n    HIT\n    out += show(x) + " ";\n  }' },
  "consumer-of-yield-star": { helper: "yield* c;", text: 'for (const x of eachID(c)) {\n    HIT\n    out += show(x) + " ";\n  }' },
  pattern: { helper: "for (const x of c) {\n    HIT\n    yield x;\n  }", text: "const [a, b, ...rest] = eachID(c);\n  out += show(a) + show(b) + rest.map(show).join();" },
  "set-of-a-generator": { helper: "for (const x of c) {\n    HIT\n    yield x;\n  }", text: "out += new Set(eachID(c)).size;" },
  "call-with-a-spread": { helper: "for (const x of c) {\n    HIT\n    yield x;\n  }", text: "out += ((...all: unknown[]) => all.map(show).join())(...eachID(c));" },
  "iterator-helpers": { text: "out += (c.values() as any)\n    .map((x: unknown) => {\n      HIT\n      return show(x);\n    })\n    .toArray()\n    .join();" },
  join: { text: 'out += c.join("+");', needs: "objects" },
  "string-of": { text: "out += String(c);", needs: "objects" },
  template: { text: "out += `${c}`;", needs: "objects" },
  "sort-by-text": { text: "c.sort();\n  out += c.map(show).join();", needs: "objects" },
  json: { text: "out += JSON.stringify(c);", needs: "objects" },
  "json-inside": { text: "out += JSON.stringify({ list: c, n: c.length });", needs: "objects" },
  "json-replacer": { text: "out += JSON.stringify(c, (key, value) => {\n    HIT\n    return typeof value === \"bigint\" ? 0 : value;\n  });" },
  "json-reviver": {
    text: 'out += show(\n    JSON.parse("[" + c.map((_, i) => i).join() + "]", function (this: any, key: string, value: unknown) {\n      const c = this;\n      HIT\n      out += key + show(value) + " ";\n      return value;\n    }),\n  );',
    inlineOnly: true,
  },
  "index-of-from": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 0;\n    },\n  };\n  out += c.indexOf(c[c.length - 1], from);", once: true },
  "last-index-of-from": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return c.length - 1;\n    },\n  };\n  out += c.lastIndexOf(c[0], from);", once: true },
  "includes-from": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 0;\n    },\n  };\n  out += c.includes(c[c.length - 1], from);", once: true },
  "fill-from": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 1;\n    },\n  };\n  c.fill(FRESH(0), from);", once: true },
  "fill-to": { text: "const to: any = {\n    valueOf() {\n      HIT\n      return 1000;\n    },\n  };\n  c.fill(FRESH(0), 0, to);", once: true },
  "slice-from": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 0;\n    },\n  };\n  out += c.slice(from).map(show).join();", once: true },
  "slice-to": { text: "const to: any = {\n    valueOf() {\n      HIT\n      return 1000;\n    },\n  };\n  out += c.slice(0, to).map(show).join();", once: true },
  "splice-from": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 1;\n    },\n  };\n  out += c.splice(from, 2, FRESH(1)).map(show).join();", once: true },
  "splice-count": { text: "const count: any = {\n    valueOf() {\n      HIT\n      return 1000;\n    },\n  };\n  out += c.splice(0, count).map(show).join();", once: true },
  "copy-within": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 1;\n    },\n  };\n  c.copyWithin(0, from);", once: true },
  "at-index": { text: "const index: any = {\n    valueOf() {\n      HIT\n      return -1;\n    },\n  };\n  out += show(c.at(index));", once: true },
  "with-index": { text: "const index: any = {\n    valueOf() {\n      HIT\n      return c.length - 1;\n    },\n  };\n  out += c.with(index, FRESH(2)).map(show).join();", once: true },
  "to-spliced": { text: "const from: any = {\n    valueOf() {\n      HIT\n      return 1;\n    },\n  };\n  out += c.toSpliced(from, 1).map(show).join();", once: true },
  "element-by-a-key-that-converts": { text: "const key: any = {\n    toString() {\n      HIT\n      return \"1\";\n    },\n  };\n  out += show(c[key]) + show(c[0]);", once: true },
  "store-of-a-value-computed-late": { text: "c[c.length - 1] = (() => {\n    HIT\n    return FRESH(3);\n  })();", once: true },
  "push-of-a-value-computed-late": { text: "out += c.push(\n    c[0],\n    (() => {\n      HIT\n      return FRESH(3);\n    })(),\n  );", once: true },
  "concat-with-a-getter": { text: "const more: any = {\n    length: 2,\n    0: FRESH(4),\n    get [Symbol.isConcatSpreadable]() {\n      HIT\n      return true;\n    },\n  };\n  out += c.concat(more, c).map(show).join();", once: true },
  "length-that-converts": { text: "const n: any = {\n    valueOf() {\n      HIT\n      return 2;\n    },\n  };\n  c.length = n;", once: true },
  "waits-for-of": { text: 'for (const x of c) {\n    await null;\n    HIT\n    out += show(x) + " ";\n  }', isAsync: true },
  "waits-by-index": { text: 'for (let i = 0; i < c.length; i++) {\n    const x = c[i];\n    await null;\n    HIT\n    out += show(x) + show(c[i]) + " ";\n  }', isAsync: true },
  "waits-length-once": { text: 'const n = c.length;\n  for (let i = 0; i < n; i++) {\n    await null;\n    HIT\n    out += show(c[i]) + " ";\n  }', isAsync: true },
  "for-await": { text: 'for await (const x of c) {\n    HIT\n    out += show(x) + " ";\n  }', isAsync: true },
  "all-of-a-map": { text: "out += (\n    await Promise.all(\n      c.map(async (x, i) => {\n        await null;\n        HIT\n        return show(x) + show(c[i]);\n      }),\n    )\n  ).join();", isAsync: true },
};

// `c` is the array, `step` the number of the next step, `FRESH(i)` a new element, `OTHER` an element of another kind that the type allows, `LIE` one that it does not.
const listChanges: Record<string, string> = {
  "push-one": "c.push(FRESH(step));",
  "push-many": "for (let k = 0; k < 3000; k++) c.push(FRESH(k));\n c.length = Math.min(c.length, 40);",
  "push-and-keep": "for (let k = 0; k < 70; k++) c.push(FRESH(k));",
  pop: "c.pop();",
  "pop-all": "while (c.length) c.pop();",
  empty: "c.length = 0;",
  "empty-and-fill-again": "c.length = 0;\n for (let k = 0; k < 5; k++) c.push(FRESH(k + 50));",
  "length-one": "c.length = 1;",
  "one-shorter": "c.length = Math.max(0, c.length - 1);",
  "ten-longer": "c.length += 10;",
  "length-far-out": "c.length = 150000;",
  "length-far-out-and-back": "const n = c.length;\n c.length = 4294967295;\n c.length = n;",
  shift: "c.shift();",
  "shift-all": "while (c.length) c.shift();",
  unshift: "c.unshift(FRESH(step));",
  "unshift-many": "for (let k = 0; k < 40; k++) c.unshift(FRESH(k));",
  "splice-first": "c.splice(0, 1);",
  "splice-here": "c.splice(step, 1);",
  "splice-more-in": "c.splice(step, 1, FRESH(1), FRESH(2), FRESH(3));",
  "hole-ahead": "delete c[step];",
  "hole-first": "delete c[0];",
  "holes-everywhere": "for (let k = 0; k < c.length; k += 2) delete c[k];",
  "another-kind-ahead": "c[step] = OTHER;",
  "another-kind-first": "c[0] = OTHER;",
  "another-kind-everywhere": "for (let k = 0; k < c.length; k++) c[k] = OTHER;",
  "lie-ahead": "(c as any)[step] = LIE;",
  "lie-first": "(c as any)[0] = LIE;",
  "lie-pushed": "(c as any).push(LIE);",
  "one-beyond": "c[c.length + 1] = FRESH(step);",
  "far-out": "c[c.length + 120000] = FRESH(step);\n c.length = Math.min(c.length, 30);",
  "far-out-kept": "c[100050] = FRESH(step);",
  "accessor-ahead": "Object.defineProperty(c, step, { get: () => FRESH(77), configurable: true, enumerable: true });",
  "accessor-first": "Object.defineProperty(c, 0, { get: () => FRESH(78), set() {}, configurable: true, enumerable: true });",
  "read-only-ahead": "Object.defineProperty(c, step, { value: FRESH(79), writable: false, configurable: true, enumerable: true });",
  "hidden-ahead": "Object.defineProperty(c, step, { value: FRESH(80), writable: true, configurable: true, enumerable: false });",
  "length-read-only": 'Object.defineProperty(c, "length", { writable: false });',
  freeze: "Object.freeze(c);",
  seal: "Object.seal(c);",
  "no-more": "Object.preventExtensions(c);",
  "prototype-with-elements": "delete c[step];\n Object.setPrototypeOf(c, Object.create(Array.prototype, { [step]: { value: FRESH(81), configurable: true, enumerable: true, writable: true } }));",
  "prototype-with-an-accessor": "delete c[step];\n Object.setPrototypeOf(c, Object.create(Array.prototype, { [step]: { get: () => FRESH(82), configurable: true } }));",
  "prototype-of-the-subclass": "Object.setPrototypeOf(c, List.prototype);",
  reverse: "c.reverse();",
  "sort-inside": "c.sort();",
  fill: "c.fill(FRESH(9));",
  "copy-within": "c.copyWithin(0, 1);",
  "a-name": "(c as any).extra = step;",
  "many-names": 'for (let k = 0; k < 80; k++) (c as any)["n" + k] = k;',
  collect: "Bun.gc(true);",
  throws: 'throw new Error("stop at " + step);',
  again: "if (depth++ === 0) AGAIN",
};

const keyedKinds: { name: string; type: string; make: string; key: (i: string) => string; isMap: boolean }[] = [
  { name: "map-of-numbers", type: "Map<number, number>", make: "c.set(i, i * 2)", key: i => i, isMap: true },
  { name: "map-of-fractions", type: "Map<number, string>", make: 'c.set(i + 0.5, "v" + i)', key: i => `((${i}) + 0.5)`, isMap: true },
  { name: "map-of-strings", type: "Map<string, Item>", make: 'c.set("k" + i, new Item(i))', key: i => `("k" + (${i}))`, isMap: true },
  { name: "map-of-objects", type: "Map<Item, number>", make: "c.set(items[i], i)", key: i => `items[${i}]`, isMap: true },
  { name: "set-of-numbers", type: "Set<number>", make: "c.add(i)", key: i => i, isMap: false },
  { name: "set-of-strings", type: "Set<string>", make: 'c.add("k" + i)', key: i => `("k" + (${i}))`, isMap: false },
  { name: "set-of-objects", type: "Set<Item>", make: "c.add(items[i])", key: i => `items[${i}]`, isMap: false },
];
const keyedWalks: Record<string, Walk & { only?: "map" | "set" }> = {
  "for-of": { text: 'for (const e of c) {\n    HIT\n    out += (Array.isArray(e) ? show(e[0]) + "=" + show(e[1]) : show(e)) + " ";\n  }' },
  "for-of-pattern": { text: 'for (const [k, v] of c) {\n    HIT\n    out += show(k) + "=" + show(v) + " ";\n  }', only: "map" },
  keys: { text: 'for (const k of c.keys()) {\n    HIT\n    out += show(k) + " ";\n  }' },
  values: { text: 'for (const v of c.values()) {\n    HIT\n    out += show(v) + " ";\n  }' },
  entries: { text: 'for (const [k, v] of c.entries()) {\n    HIT\n    out += show(k) + "=" + show(v) + " ";\n  }' },
  "keys-and-get": { text: 'for (const k of c.keys()) {\n    HIT\n    out += show(k) + "=" + show(c.get(k)) + c.has(k) + " ";\n  }', only: "map" },
  "for-each": { text: 'c.forEach((v: unknown, k: unknown) => {\n    HIT\n    out += show(k) + "=" + show(v) + " ";\n  });' },
  "iterator-by-hand": { text: 'const it = c.keys();\n  for (let r = it.next(); !r.done; r = it.next()) {\n    HIT\n    out += show(r.value) + " ";\n  }' },
  "two-iterators": { text: 'const first = c.keys();\n  const second = c.values();\n  for (let r = first.next(); !r.done; r = first.next()) {\n    HIT\n    out += show(r.value) + "/" + show(second.next().value) + " ";\n  }' },
  "array-from": { text: "out += Array.from(c.keys(), k => {\n    HIT\n    return show(k);\n  }).join();" },
  "generator-spread": { helper: "for (const k of c.keys()) {\n    HIT\n    yield k;\n  }", text: "out += [...eachID(c)].map(show).join();" },
  "consumer-of-yield-star": { helper: "yield* c.keys();", text: 'for (const k of eachID(c)) {\n    HIT\n    out += show(k) + " ";\n  }' },
  "size-in-a-loop": { text: 'for (let i = 0; i < c.size; i++) {\n    HIT\n    out += c.size + " ";\n  }' },
  "waits-for-of": { text: 'for (const k of c.keys()) {\n    await null;\n    HIT\n    out += show(k) + " ";\n  }', isAsync: true },
};
// `KEY(i)` is the key made i-th; `ADD(i)` adds it.
const keyedChanges: Record<string, string> = {
  "delete-here": "c.delete(KEY(step - 1));",
  "delete-ahead": "c.delete(KEY(step));",
  "delete-behind": "for (let k = 0; k < step - 1; k++) c.delete(KEY(k));",
  "delete-all-ahead": "for (let k = step; k < 200; k++) c.delete(KEY(k));",
  clear: "c.clear();",
  "clear-and-add-again": "c.clear();\n for (let i = 0; i < 4; i++) ADD;",
  "add-one": "{\n  const i = 150;\n  ADD;\n }",
  "add-many": "for (let i = 100; i < 190; i++) ADD;",
  "add-many-and-delete-them": "for (let i = 100; i < 199; i++) ADD;\n for (let k = 100; k < 199; k++) c.delete(KEY(k));",
  "delete-and-add-here": "{\n  const i = step - 1;\n  c.delete(KEY(i));\n  ADD;\n }",
  "delete-and-add-ahead": "{\n  const i = step;\n  c.delete(KEY(i));\n  ADD;\n }",
  "delete-every-other": "for (let k = 0; k < 200; k += 2) c.delete(KEY(k));",
  collect: "Bun.gc(true);",
  throws: 'throw new Error("stop at " + step);',
  again: "if (depth++ === 0) AGAIN",
};

const objectMakers: Record<string, string> = {
  "name-by-name": 'const c: Record<string, unknown> = {};\n  for (let i = 0; i < N; i++) {\n    if (i % 2) c["k" + i] = E(i);\n    else Object.defineProperty(c, "k" + i, { get: () => (hit(), E(i)), enumerable: true, configurable: true });\n  }\n  return c;',
  "values-alone": 'const c: Record<string, unknown> = {};\n  for (let i = 0; i < N; i++) c["k" + i] = E(i);\n  return c;',
  literal: "return { k0: E(0), get k1() {\n    hit();\n    return E(1);\n  }, k2: E(2), get k3() {\n    hit();\n    return E(3);\n  }, k4: E(4), k5: E(5) };",
  "of-a-class": "return new Fields() as unknown as Record<string, unknown>;",
  "with-indexes": 'const c: Record<string, unknown> = {};\n  for (let i = 0; i < N; i++) c[i % 3 ? "k" + i : String(i)] = E(i);\n  return c;',
  "without-a-prototype": 'const c: Record<string, unknown> = Object.create(null);\n  for (let i = 0; i < N; i++) c["k" + i] = E(i);\n  return c;',
  proxied: 'const c: Record<string, unknown> = {};\n  for (let i = 0; i < N; i++) c["k" + i] = E(i);\n  return watched(c);',
};
const objectWalks: Record<string, Walk> = {
  "for-in": { text: 'for (const k in c) {\n    HIT\n    out += k + "=" + show(c[k]) + " ";\n  }' },
  "for-in-own": { text: 'for (const k in c) {\n    HIT\n    if (Object.hasOwn(c, k)) out += k + " ";\n  }' },
  "for-in-stores": { text: "for (const k in c) {\n    HIT\n    c[k] = 1;\n  }" },
  "keys-then-reads": { text: 'for (const k of Object.keys(c)) {\n    HIT\n    out += k + "=" + show(c[k]) + " ";\n  }' },
  values: { text: "out += Object.values(c).map(show).join();" },
  entries: { text: 'out += Object.entries(c)\n    .map(([k, v]) => k + "=" + show(v))\n    .join();' },
  assign: { text: "out += lookAtObject(Object.assign({}, c));" },
  "assign-onto-itself": { text: "out += lookAtObject(Object.assign(c, c));" },
  spread: { text: "out += lookAtObject({ ...c });" },
  "rest-pattern": { text: "const { k0, k1, ...rest } = c;\n  out += show(k0) + show(k1) + lookAtObject(rest);" },
  json: { text: "out += JSON.stringify(c);" },
  "json-indented": { text: "out += JSON.stringify(c, null, 1);" },
  "json-replacer": { text: "out += JSON.stringify(c, (key, value) => {\n    HIT\n    return value;\n  });" },
  "json-reviver": {
    text: "out += lookAtObject(\n    JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(c).map((k, i) => [k, i]))), function (this: any, key: string, value: unknown) {\n      const c = this;\n      HIT\n      out += key + show(value) + \" \";\n      return value;\n    }),\n  );",
    inlineOnly: true,
  },
  clone: { text: "out += lookAtObject(structuredClone(c));" },
  "map-of-entries": { text: "out += new Map(Object.entries(c)).size;" },
  "define-properties": { text: "out += lookAtObject(Object.defineProperties({}, Object.fromEntries(Object.keys(c).map(k => [k, { get value() {\n    HIT\n    return c[k];\n  }, enumerable: true }]))));" },
  "own-keys-then-reads": { text: 'for (const k of Reflect.ownKeys(c)) {\n    HIT\n    out += String(k) + "=" + show(c[k as string]) + " ";\n  }' },
  "waits-for-in": { text: 'for (const k in c) {\n    await null;\n    HIT\n    out += k + "=" + show(c[k]) + " ";\n  }', isAsync: true },
};
const objectChanges: Record<string, string> = {
  "delete-ahead": 'delete c["k" + step];',
  "delete-two-ahead": 'delete c["k" + (step + 1)];',
  "delete-all": "for (const k of Object.keys(c)) delete c[k];",
  "delete-first": "delete c.k0;",
  "add-one": 'c["z" + step] = step;',
  "add-many": 'for (let k = 0; k < 150; k++) c["z" + k] = k;',
  "add-an-index": "c[7] = step;",
  "delete-and-add-ahead": 'delete c["k" + step];\n c["k" + step] = "again";',
  "accessor-ahead": 'Object.defineProperty(c, "k" + step, { get: () => "computed", enumerable: true, configurable: true });',
  "value-ahead": 'Object.defineProperty(c, "k" + step, { value: "plain", enumerable: true, configurable: true, writable: true });',
  "hidden-ahead": 'Object.defineProperty(c, "k" + step, { enumerable: false });',
  "another-kind-ahead": 'c["k" + step] = { other: 1 };',
  freeze: "Object.freeze(c);",
  "prototype-with-names": "Object.setPrototypeOf(c, { inherited: 1, k1: 2 });",
  "no-prototype": "Object.setPrototypeOf(c, null);",
  collect: "Bun.gc(true);",
  throws: 'throw new Error("stop at " + step);',
  again: "if (depth++ === 0) AGAIN",
};

export function generate(random: Random): string {
  const names: string[] = [];
  const text: string[] = [
    prelude,
    `const items: Item[] = Array.from({ length: 200 }, (_, i) => new Item(i));
class Fields {
  k0: number = 1;
  k1: number = 2.5;
  k2: string = "three";
  k3: Item = new Item(4);
  k4: number[] = [5];
  k5?: number = 6;
}`,
  ];
  const calls: string[] = [];
  const scenes = random.between(4, 9);
  for (let id = 1; id <= scenes; id++) {
    const family = random.weighted([[6, "list"], [2, "keyed"], [2, "object"]] as const);
    const kind = random.pick(kinds);
    const count = random.pick([1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 33, 64, 100]);
    let type: string, make: string, walks: Record<string, Walk & { only?: string }>, changes: Record<string, string>, look: string, thing: string;
    const fresh = (i: string) => kind.element(`(9000 + ${i})`);
    let substitute = (body: string) => body;
    let plainLook: string;
    let callsHit = false;
    const keyed = random.pick(keyedKinds);
    if (family === "list") {
      const maker = random.pick(Object.keys(listMakers));
      thing = kind.name + "-" + maker;
      type = maker === "subclass" ? `List<${kind.type}>` : `Array<${kind.type}>`;
      make = listMakers[maker];
      walks = listWalks;
      changes = listChanges;
      look = "lookAtList";
      callsHit = maker === "proxied";
      plainLook = 'let all = "length " + c.length + ":";\n  for (let i = 0; i < c.length && i < 24; i++) all += " " + (i in c ? show(c[i]) : "-");\n  return all;';
    } else if (family === "keyed") {
      thing = keyed.name;
      type = keyed.type;
      make = `const c: ${keyed.type} = new ${keyed.isMap ? "Map" : "Set"}();\n  for (let i = 0; i < N; i++) ${keyed.make};\n  return c;`;
      walks = Object.fromEntries(Object.entries(keyedWalks).filter(([, walk]) => !walk.only || (walk.only === "map") === keyed.isMap));
      changes = keyedChanges;
      look = "lookAtKeyed";
      plainLook = 'let all = "size " + c.size + ":";\n  let n = 0;\n  for (const k of c.keys()) if (n++ < 24) all += " " + show(k);\n  return all;';
      substitute = body => body.replace(/KEY\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, (_, i) => keyed.key(i)).replaceAll("ADD", () => keyed.make);
    } else {
      const maker = random.pick(Object.keys(objectMakers));
      thing = "object-" + maker + "-" + kind.name;
      type = "Record<string, unknown>";
      make = objectMakers[maker];
      walks = objectWalks;
      changes = objectChanges;
      look = "lookAtObject";
      callsHit = maker !== "values-alone" && maker !== "with-indexes" && maker !== "without-a-prototype" && maker !== "of-a-class";
      plainLook = 'let all = "";\n  for (const k in c) all += " " + k + "=" + show(c[k]);\n  return all;';
    }
    const usable = Object.keys(walks).filter(name => !walks[name].needs || (walks[name].needs === "objects" ? kind.isObject : kind.isNumber));
    const walkName = random.pick(usable);
    const walk = walks[walkName];
    const changeName = random.pick(Object.keys(changes));
    const behind = random.weighted([[3, ""], [1, "\n Bun.gc(true);"], [3, "\n refill();"]] as const);
    const reach = walk.inlineOnly ? "written-there" : walk.isAsync && random.chance(0.4) ? "another-job" : random.pick(["written-there", "a-function", "a-closure"]);
    const fill = (body: string) =>
      substitute(body)
        .replace(/FRESH\(([^()]*)\)/g, (_, i) => fresh(i))
        .replace(/E\(([^()]*)\)/g, (_, i) => kind.element(i))
        .replaceAll("OTHER", () => random.pick(kind.others))
        .replaceAll("LIE", () => random.pick(lies))
        .replace(/\bN\b/g, String(count))
        .replace(/\bT\b/g, kind.type)
        .replaceAll("eachID", "each" + id);
    const wait = walk.isAsync ? "await " : "";
    // Whoever hands the thing to a closure or to a function that takes anything tells the compiler less about it: most scenes do neither.
    const needsTheClosure = reach === "a-closure" || callsHit || walk.needs === "objects";
    const looksPlainly = random.chance(0.7);
    const change = fill(changes[changeName]).replaceAll("AGAIN", () => (walk.isAsync ? `void walk${id}(c);` : `walk${id}(c);`)) + behind;
    const hitText = reach === "written-there" ? `if (step++ === at) {\n ${change}\n }` : reach === "a-function" ? `if (step++ === at) change${id}(c);` : reach === "a-closure" ? "hit();" : "";
    const steps = walk.once ? [0] : random.sample([0, 1, 2, count >> 1, count - 1, count], random.between(2, 3)).filter((value, index, all) => all.indexOf(value) === index);
    names.push([thing, count, walkName, changeName, reach, behind ? (behind.includes("refill") ? "refilled" : "collected") : "left"].join("-"));
    text.push(`function make${id}(): ${type} {
  ${fill(make)}
}
${needsTheClosure || reach === "a-function" || reach === "another-job" ? `function change${id}(c: ${type}): void {\n ${change}\n}\n` : ""}${looksPlainly ? `function look${id}(c: ${type}): string {\n  ${plainLook}\n}\n` : ""}${walk.helper ? `function* each${id}(c: ${type}) {\n  ${fill(walk.helper).replaceAll("HIT", () => hitText)}\n}\n` : ""}${walk.isAsync ? "async " : ""}function walk${id}(c: ${type}): ${walk.isAsync ? "Promise<string>" : "string"} {
  let out = "";
  ${fill(walk.text).replaceAll("HIT", () => hitText)}
  return out;
}
${walk.isAsync ? "async " : ""}function scene${id}(): ${walk.isAsync ? "Promise<void>" : "void"} {
  for (const when of [${steps.join(", ")}]) {
    const c = make${id}();
    step = depth = 0;
    at = ${reach === "another-job" ? "-1" : "when"};
    damage = ${needsTheClosure ? `() => change${id}(c)` : "idle"};
    let first: string;
    try {
      ${
        reach === "another-job"
          ? `const walking = walk${id}(c);\n      for (let turn = 0; turn < when * 2 + 1; turn++) await null;\n      step = when;\n      try {\n        change${id}(c);\n      } catch {}\n      first = await walking;`
          : `first = ${wait}walk${id}(c);`
      }
    } catch (error) {
      first = describe(error);
    }
    at = -1;
    step = 0;
    depth = 1;
    let seen: string;
    let second: string;
    try {
      seen = ${looksPlainly ? "look" + id : look}(c);
    } catch (error) {
      seen = describe(error);
    }
    try {
      second = ${wait}walk${id}(c);
    } catch (error) {
      second = describe(error);
    }
    console.log("${id} at " + when + ": " + brief(first) + " | " + brief(seen) + " | " + brief(second));
  }
}`);
    calls.push(`${wait}scene${id}();`);
  }
  text.push(calls.join("\n"));
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
