// Regression programs for the built-in families: arrays, objects, Map and Set, for-in, generators, typed arrays, Math,
// strings, promises.
// Each program must print the same output compiled with --aot as it does under plain Bun.
import { type Regression, runRegressions } from "./family-regression-runner";

const fortyStrings = Array.from({ length: 40 }, (_, index) => `"s${String(index).padStart(2, "0")}"`).join(", ");
const seventeenIntegers = Array.from({ length: 17 }, (_, index) => index * 3 + 10).join(", ");

const regressions: Regression[] = [
  {
    name: "object-values-lazy-methods.ts",
    covers: "Object.values and Object.entries stored deferred closures without a write barrier",
    stressesCollector: true,
    source: `
      const make = () => ({
        a() { return 1; }, b() { return 2; }, c() { return 3; }, d() { return 4; },
        e() { return 5; }, f() { return 6; }, g() { return 7; }, h() { return 8; },
        i() { return 9; }, j() { return 10; }, k() { return 11; }, l() { return 12; },
      });
      type Methods = ReturnType<typeof make>; type Method = () => number;
      function listValues(o: Methods): Method[] { return Object.values(o); }
      function listEntryValues(o: Methods): Method[] { return Object.entries(o).map(pair => pair[1]); }
      function collectEntryValues(o: Methods): Method[] {
        const methods: Method[] = [];
        for (const [key, value] of Object.entries(o)) if (key !== "") methods.push(value);
        return methods;
      }
      function listUntypedValues(o: any): Method[] { return Object.values(o); }
      function sumCalls(list: (o: Methods) => Method[], rounds: number): number {
        let sum = 0;
        for (let round = 0; round < rounds; round++) {
          const methods = list(make()), garbage: { round: number }[] = [];
          for (let n = 0; n < 40; n++) garbage.push({ round });
          for (const method of methods) sum += method();
          sum += garbage[round % 40].round;
        }
        return sum;
      }
      function keepsIdentity(o: Methods): boolean {
        const before = Object.values(o);
        Bun.gc(true);
        return Object.values(o)[0] === o.a && before[0] === o.a && before[11]() === 12;
      }
      let runs = 0;
      const tag = Symbol("tag");
      function listOwn(o: any): unknown { return [Object.values(o), Object.entries(o)]; }
      function reportOtherSubjects(when: string): void {
        report(when + ": getter", () => [listOwn({ first: 1, get second() { return ++runs; }, third: 3 }), runs]);
        report(when + ": index key", () => listOwn({ b: 2, 1: "a" }));
        report(when + ": hidden", () => listOwn(Object.defineProperty({ shown: 1, [tag]: 2 }, "hidden", { value: 3 })));
        report(when + ": own __proto__", () => listOwn(JSON.parse('{"__proto__": 1, "x": 2}')));
        report(when + ": proxy", () => listOwn(new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["b", "a"] })));
        report(when + ": null", () => listOwn(null));
        report(when + ": string", () => listOwn("ab"));
      }
      for (const list of [listValues, listEntryValues, collectEntryValues, listUntypedValues])
        report(list.name, () => sumCalls(list, 750));
      report("identity", () => [keepsIdentity(make()), keepsIdentity(make())]);
      reportOtherSubjects("before");
      const holder = {}; Object.create(holder);
      Object.defineProperty(holder, 0, { get() { return "inherited"; }, configurable: true });
      reportOtherSubjects("after a bad time");
      report("methods after a bad time", () => sumCalls(listValues, 10) + sumCalls(listEntryValues, 10));
    `,
  },
  {
    name: "array-from-huge-length.js",
    covers: "TryPutByValDirect stored into an ArrayStorage array",
    source: `
      function fill(length, stopAt) {
        return Array.from({ length }, (_, i) => {
          if (i === 4) Bun.gc(true);
          if (i === stopAt) throw new RangeError("stop");
          return i * 2;
        });
      }
      report("2 ** 27", () => fill(2 ** 27, 8));
      report("2 ** 27 + 1", () => fill(2 ** 27 + 1, 8));
      report("6", () => fill(6, 9));
      report("0", () => fill(0, 0));
    `,
  },
  {
    name: "map-huge-sparse-length.ts",
    covers: "TryPutByValDirect stored into an ArrayStorage array",
    source: `
      function doubleUntil(stop: number): (value: number, index: number) => number {
        return (value, index) => { if (index === stop) throw new RangeError("stop"); return value * 2; };
      }
      function mapUntil(a: number[], stop: number): number[] { return a.map(doubleUntil(stop)); }
      function filterUntil(a: number[], stop: number): number[] {
        const double = doubleUntil(stop);
        return a.filter((value, index) => double(value, index) > 2);
      }
      function sliceTail(a: number[]): number[] { return a.slice(1); }
      function concatBoth(a: number[], b: number[]): number[] { return a.concat(b); }
      function summarize(a: number[]): unknown { return [a.length, 1 in a, 4 in a, Object.keys(a).join(), a]; }
      const sparse = [1, 2, 3, 4];
      sparse.length = 2 ** 31;
      report("length", () => sparse.length);
      report("map over 2 ** 31", () => summarize(mapUntil(sparse, 3)));
      report("filter over 2 ** 31", () => summarize(filterUntil(sparse, 3)));
      sparse.length = 6;
      delete sparse[1];
      report("map over 6", () => summarize(mapUntil(sparse, -1)));
      report("filter over 6", () => summarize(filterUntil(sparse, -1)));
      report("slice of 6", () => summarize(sliceTail(sparse)));
      report("concat of 6 and 6", () => summarize(concatBoth(sparse, sparse)));
    `,
  },
  {
    name: "atomics-store-large-numbers.ts",
    covers: "Atomics.store of 2 ** 63 stored -1 on arm64",
    source: `
      const storeInt8 = (view: Int8Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
      const storeUint8 = (view: Uint8Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
      const storeInt16 = (view: Int16Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
      const storeUint16 = (view: Uint16Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
      const storeInt32 = (view: Int32Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
      const storeUint32 = (view: Uint32Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
      function storeInEach(value: number): string {
        return [
          storeInt8(new Int8Array(1), value), storeUint8(new Uint8Array(1), value),
          storeInt16(new Int16Array(1), value), storeUint16(new Uint16Array(1), value),
          storeInt32(new Int32Array(1), value), storeUint32(new Uint32Array(1), value),
        ].join(" ");
      }
      const numbers = [
        2 ** 63, -(2 ** 63), 2 ** 63 + 2048, 2 ** 64, 2 ** 62, 2 ** 53 + 2, 2 ** 32 + 5, 2 ** 31, -(2 ** 31) - 1,
        1e300, -1e300, Infinity, -Infinity, NaN, -0, 1.9, -1.9,
      ];
      for (const value of numbers) report(show(value), () => storeInEach(value));
    `,
  },
  {
    name: "literal-prototype-any-value.ts",
    covers: "a literal with __proto__: null threw a TypeError",
    source: `
      class Base { y = 7; }
      function make(p: any) { return { __proto__: p, x: 1 }; }
      function makeWithNull(x: number) { return { __proto__: null, x }; }
      function makeWithNumber(x: number) { return { __proto__: 5, x }; }
      function inherit(p: { y: number }) { return { __proto__: p, x: 1 }; }
      function readY(o: { y: number }): number { return o.y; }
      function summarize(o: { x: number }, p: unknown): unknown {
        return [Object.getPrototypeOf(o) === p, Object.getPrototypeOf(o) === Object.prototype, Object.keys(o), o.x];
      }
      function summarizeTyped(p: { y: number }): unknown {
        const o = inherit(p);
        return [summarize(o, p), (o as any).y, readY(o as any)];
      }
      const prototypes: [string, unknown][] = [
        ["null", null], ["undefined", undefined], ["number", 5], ["string", "s"], ["boolean", true],
        ["symbol", Symbol.iterator], ["bigint", 10n], ["object", {}], ["array", []], ["function", () => 0],
        ["instance", new Base()],
      ];
      for (const [label, p] of prototypes) report(label, () => summarize(make(p), p));
      report("null in the literal", () => [summarize(makeWithNull(1), null), summarize(makeWithNull(2), null)]);
      report("number in the literal", () => [summarize(makeWithNumber(1), 5), summarize(makeWithNumber(2), 5)]);
      report("typed literal", () => summarizeTyped({ y: 2 }));
      report("typed instance", () => summarizeTyped(new Base()));
      report("typed null", () => summarizeTyped(null as any));
    `,
  },
  {
    name: "iterator-results-before-any-generator.js",
    covers: "the iterator result header was filled only when a generator was created",
    source: `
      function take(iterator, n) {
        const steps = [];
        for (let i = 0; i < n; i++) steps.push(iterator.next());
        return steps;
      }
      function summarize(steps) {
        Bun.gc(true);
        return steps.map(step => [
          JSON.stringify(step), Object.keys(step).join(), Object.getPrototypeOf(step) === Object.prototype,
        ]);
      }
      function countTo(limit) {
        let count = 0;
        return {
          [Symbol.iterator]() { return this; },
          next() { const done = count >= limit, value = done ? undefined : ++count; return { value, done }; },
        };
      }
      function collect(iterable) { const seen = []; for (const value of iterable) seen.push(value); return seen; }
      function spread(iterable) { return [...iterable]; }
      function destructure(iterable) { const [first, second, ...rest] = iterable; return [first, second, rest]; }
      const list = ["a", "b"], map = new Map([["k", 1], ["l", 2]]), set = new Set(["x", "y"]);
      const iterators = {
        "array": () => list[Symbol.iterator](), "array entries": () => list.entries(), "array keys": () => list.keys(),
        "map": () => map[Symbol.iterator](), "map entries": () => map.entries(), "map keys": () => map.keys(),
        "map values": () => map.values(), "set values": () => set.values(), "string": () => "ab"[Symbol.iterator](),
        "matchAll": () => "a1b2".matchAll(/[0-9]/g), "hand-written": () => countTo(2),
      };
      for (const [label, create] of Object.entries(iterators)) report(label, () => summarize(take(create(), 4)));
      report("for-of", () => [collect(countTo(3)), collect(countTo(0))]);
      report("spread", () => [spread(countTo(3)), spread(countTo(0))]);
      report("destructuring", () => [destructure(countTo(4)), destructure(countTo(1))]);
    `,
  },
  {
    name: "first-map-in-worker.ts",
    covers: "a new VM's array allocation words were filled lazily",
    neverCalls: ["operationAOTNewArrayWithHoles"],
    source: `
      import { Worker } from "node:worker_threads";
      new Worker("./worker.ts").on("message", (message: unknown) => report("worker", () => message));
    `,
    files: {
      "worker.ts": `
        import { parentPort } from "node:worker_threads";
        const doubled = [1, 2, 3].map(x => x * 2);
        parentPort?.postMessage([doubled, doubled.length, Array.isArray(doubled)]);
      `,
    },
  },
  {
    name: "spread-after-arrays-change-storage.js",
    covers: "a spread stored contiguous elements into a SlowPutArrayStorage array",
    stressesCollector: true,
    source: `
      const holder = {}; Object.create(holder);
      let calls = 0;
      const source = [1, 2, 3, 4];
      const mapped = source.map(x => {
        if (++calls === 2) Object.defineProperty(holder, 0, { get() { return "inherited"; }, configurable: true });
        return x * 2;
      });
      function createArrays(a, b) {
        return [
          [...a], [...a, 9], [0, ...a, ...b], [...b.filter(x => x > 1)],
          Array.from(a, x => x + 1), Array.from({ length: 3 }, (_, i) => i),
          a.concat(b), a.slice(1), b.map(x => x + 0.5), b.flatMap(x => [x, x]),
        ];
      }
      function extend(list) {
        list.push(7);
        list[list.length + 1] = 8;
        return [list, list.length, Object.keys(list).join()];
      }
      report("mapped", () => [mapped, mapped.length, Object.keys(mapped).join()]);
      report("first", () => createArrays(mapped, source).map(extend));
      Bun.gc(true);
      report("after a collection", () => createArrays(mapped, source).map(extend));
      let total = 0;
      for (let round = 0; round < 200; round++)
        for (const list of createArrays(mapped, source)) total += extend(list)[1];
      report("200 rounds", () => total);
    `,
  },
  {
    name: "constant-collections-walked-twice.ts",
    covers: "CollectionTable skipped its in-image test after an earlier walk",
    source: `
      const names = new Set(["alpha", "beta", "gamma", "delta"]);
      const ages = new Map([["ann", 31], ["bob", 27], ["cy", 45]]);
      function walkTwice(set: Set<string>): string {
        let seen = "";
        for (const name of set) seen += name + " ";
        for (const name of set) seen += name.length;
        set.forEach(name => { seen += " " + name; });
        set.forEach((name, again, whole) => { seen += name === again && whole === set ? "=" : "!"; });
        return seen;
      }
      function walkNested(set: Set<string>): string[] {
        const pairs: string[] = [];
        for (const outer of set) for (const inner of set) if (outer < inner) pairs.push(outer[0] + inner[0]);
        set.forEach(outer => set.forEach(inner => { if (outer > inner) pairs.push(outer[0] + inner[0]); }));
        return pairs;
      }
      function walkMap(map: Map<string, number>): (string | number)[] {
        const seen: (string | number)[] = [];
        for (const [name, age] of map) seen.push(name, age);
        for (const [name, age] of map.entries()) seen.push(name + age);
        for (const age of map.values()) seen.push(age);
        for (const name of map.keys()) seen.push(name);
        map.forEach((age, name) => { seen.push(name.length + age); });
        return seen;
      }
      function reportAll(when: string): void {
        report(when + ": set twice", () => walkTwice(names));
        report(when + ": set nested", () => walkNested(names));
        report(when + ": map", () => walkMap(ages));
        report(when + ": spread", () => [[...names], names.size, [...ages], ages.size]);
      }
      reportAll("first"); reportAll("second");
      names.add("epsilon"); names.delete("beta"); ages.set("dee", 52); ages.set("ann", 32); ages.delete("bob");
      reportAll("changed");
    `,
  },
  {
    name: "for-in-mutated-object.js",
    covers: "HasEnumerableProperty had three meanings chosen by its key operand",
    source: `
      function collectKeys(o) { const keys = []; for (const k in o) keys.push(k); return keys; }
      function testOwnKeys(o) { const seen = []; for (const k in o) seen.push(o.hasOwnProperty(k)); return seen; }
      function walk(o, change) {
        const seen = [];
        for (const k in o) {
          change(o, k);
          seen.push([k, o[k], k in o, Object.hasOwn(o, k), Object.prototype.hasOwnProperty.call(o, k)]);
        }
        return seen;
      }
      function findNextKey(o, k) {
        const keys = [...new Set([...Object.keys(o), ...Object.keys(Object.getPrototypeOf(o))])];
        return keys[keys.indexOf(k) + 1];
      }
      function redefineNextKey(o, k, descriptor) {
        const next = findNextKey(o, k);
        if (next !== undefined) Object.defineProperty(o, next, { ...descriptor, configurable: true });
      }
      class Letters { constructor() { this.a = 1; this.b = 2; this.c = 3; this.d = 4; } }
      const subjects = {
        "literal": () => ({ a: 1, b: 2, c: 3, d: 4 }),
        "instance": () => new Letters(),
        "inherited keys": () => Object.assign(Object.create({ p: 5, q: 6 }), { a: 1, b: 2 }),
        "array": () => ["w", "x", "y", "z"],
        "proxy": () => new Proxy({ a: 1, b: 2, c: 3, d: 4 }, {}),
      };
      const changes = {
        "no change": () => {},
        "next key deleted": (o, k) => { delete o[findNextKey(o, k)]; },
        "z added": o => { o.z = 26; },
        "next key becomes a getter": (o, k) => redefineNextKey(o, k, { get: () => "getter", enumerable: true }),
        "next key becomes non-enumerable": (o, k) => redefineNextKey(o, k, { enumerable: false }),
      };
      for (const [subject, create] of Object.entries(subjects))
        for (const [how, change] of Object.entries(changes)) report(subject + ", " + how, () => walk(create(), change));
      for (const value of ["ab", 5, null, undefined]) {
        report("keys of " + show(value), () => collectKeys(value));
        report("walk over " + show(value), () => walk(value, changes["no change"]));
      }
      report("no hasOwnProperty", () => testOwnKeys(Object.create(null, { a: { value: 1, enumerable: true } })));
      report("inherited hasOwnProperty", () => testOwnKeys({ a: 1, b: 2 }));
      report("own hasOwnProperty", () => testOwnKeys({ a: 1, hasOwnProperty: () => "own" }));
    `,
  },
  {
    name: "rounded-quotients-keep-negative-zero.ts",
    covers: "a rounded integer quotient lost -0",
    source: `
      function floor(a: number, b: number): number { return Math.floor(a / b); }
      function ceil(a: number, b: number): number { return Math.ceil(a / b); }
      function trunc(a: number, b: number): number { return Math.trunc(a / b); }
      function round(a: number, b: number): number { return Math.round(a / b); }
      function orZero(a: number, b: number): number { return (a / b) | 0; }
      function notTwice(a: number, b: number): number { return ~~(a / b); }
      function shiftByZero(a: number, b: number): number { return (a / b) >>> 0; }
      function imul(a: number, b: number): number { return Math.imul(a / b, 3); }
      function roundEachWay(a: number, b: number): number[] {
        const rounded = [floor(a, b), ceil(a, b), trunc(a, b), round(a, b)];
        return [...rounded, orZero(a, b), notTwice(a, b), shiftByZero(a, b), imul(a, b)];
      }
      for (let a = -4; a <= 4; a++)
        for (let b = -3; b <= 3; b++) {
          const rounded = roundEachWay(a, b);
          report(a + " / " + b, () => rounded.map(show).join(" "));
        }
    `,
  },
  {
    name: "constant-string-array-under-collection.ts",
    covers: "AOTArrayAllocationOperations.cpp",
    stressesCollector: true,
    source:
      `
      function createAndPush(extra: string): string[] { const list = [` +
      fortyStrings +
      `]; list.push(extra); return list; }
      function createOnly(): string[] { return [` +
      fortyStrings +
      `]; }
      function compare(a: string[], b: string[]): boolean[] { return [a === b, a.join() === b.join()]; }
      function store(a: string[], b: string[]): string[] { a[0] = "changed"; return [a[0], b[0], createOnly()[0]]; }
      let total = 0;
      for (let round = 0; round < 10000; round++) {
        const list = createAndPush("extra" + round);
        total += list.length + list[round % 41].length;
      }
      report("total", () => total);
      report("two arrays", () => compare(createOnly(), createOnly()));
      report("store to one", () => store(createOnly(), createOnly()));
      report("two arrays after the store", () => compare(createOnly(), createOnly()));
    `,
  },
  {
    name: "two-constant-arrays-interleaved.ts",
    covers: "AOTArrayAllocationOperations.cpp",
    source:
      `
      function createThree(extra: number): [number[], number[], string[]] {
        const first = [1, 2, 3], second = [` +
      seventeenIntegers +
      `];
        second.push(extra);
        return [first, second, ["a", "b"]];
      }
      report("first call", () => createThree(100));
      report("second call", () => createThree(200));
    `,
  },
  {
    name: "literal-with-holes.ts",
    covers: "AOTArrayAllocationEmitter.cpp",
    source: `
      function make(): (number | undefined)[] { return [1, , 3, , ]; }
      function summarize(a: (number | undefined)[]): unknown {
        return [a.length, 1 in a, show(a[1]), Object.keys(a), JSON.stringify(a), a.push(9), 3 in a, 4 in a];
      }
      report("first", () => summarize(make()));
      report("second", () => summarize(make()));
      const holder = {}; Object.create(holder);
      Object.defineProperty(holder, 0, { get() { return "inherited"; }, configurable: true });
      report("after a bad time", () => summarize(make()));
    `,
  },
  {
    name: "negative-and-huge-capacity.ts",
    covers: "AOTArrayAllocationEmitter.cpp",
    source: `
      let latest: number[] = [];
      function mayStop(i: number, stop: number): void { if (i === stop) throw new RangeError("stop"); }
      function fill(n: number, stop: number): number[] {
        const a: number[] = [];
        latest = a;
        for (let i = 0; i < n; i++) { mayStop(i, stop); a.push(i); }
        return a;
      }
      function summarize(a: number[]): unknown {
        let sum = 0;
        for (const x of a) sum += x;
        return [a.length, show(a[0]), show(a[a.length - 1]), sum];
      }
      for (const n of [-5, 0, 127, 128, 100000, 100001]) report("n = " + n, () => summarize(fill(n, -1)));
      report("n = 2 ** 31", () => summarize(fill(2 ** 31, 10)));
      report("filled before the throw", () => summarize(latest));
    `,
  },
  {
    name: "splice-removed-elements.ts",
    covers: "AOTArrayBuiltinEmitter.cpp",
    source: `
      function summarize(removed: unknown[], a: unknown[]): unknown {
        return [removed, Object.keys(removed).join(), a, Object.keys(a).join()];
      }
      function cut<T>(a: T[], start: number, count: number, ...items: T[]): unknown {
        switch (items.length) {
          case 0: return summarize(a.splice(start, count), a);
          case 1: return summarize(a.splice(start, count, items[0]), a);
          case 2: return summarize(a.splice(start, count, items[0], items[1]), a);
          default: return summarize(a.splice(start, count, ...items), a);
        }
      }
      function drop<T>(a: T[], start: number, count: number): T[] { a.splice(start, count); return a; }
      for (let count = 0; count <= 3; count++)
        for (let inserted = 0; inserted <= 3; inserted++) {
          const label = count + " removed, " + inserted + " inserted: ";
          const numbers = [70, 80, 90].slice(0, inserted), strings = ["x", "y", "z"].slice(0, inserted);
          report(label + "integers", () => cut([1, 2, 3, 4, 5], 1, count, ...numbers));
          report(label + "fractions", () => cut([1.5, 2.5, 3.5, 4.5], 1, count, ...numbers));
          report(label + "strings", () => cut(["a", "b", "c", "d"], 1, count, ...strings));
          report(label + "hole", () => cut([1, , 3, 4], 1, count, ...numbers));
        }
      report("fraction into integers", () => cut([1, 2, 3], 1, 1, 0.5));
      report("result unused", () =>
        [drop([1, 2, 3, 4, 5], 1, 2), drop([1.5, 2.5, 3.5], 0, 1), drop([1, , 3, 4], 1, 2)]);
    `,
  },
  {
    name: "concat-with-own-is-concat-spreadable.ts",
    covers: "AOTArrayBuiltinEmitter.cpp",
    source: `
      function concat(a: unknown[], b: unknown): unknown[] { return a.concat(b); }
      function concatOnto(receiver: unknown, b: unknown): unknown[] { return Array.prototype.concat.call(receiver, b); }
      function createUnspreadable(): unknown[] {
        const list: unknown[] = [1, 2];
        (list as any)[Symbol.isConcatSpreadable] = false;
        return list;
      }
      function createSpreadable(): object { return { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true }; }
      report("ordinary arrays", () => concat([0], [1, 2]));
      report("unspreadable argument", () => concat([0], createUnspreadable()));
      report("unspreadable receiver", () => concat(createUnspreadable(), [3]));
      report("unspreadable receiver and argument", () => concat(createUnspreadable(), createUnspreadable()));
      report("spreadable argument", () => concat([0], createSpreadable()));
      report("spreadable receiver", () => concatOnto(createSpreadable(), [3]));
      report("array-like argument without the symbol", () => concat([0], { length: 1, 0: "a" }));
      report("array-like receiver without the symbol", () => concatOnto({ length: 1, 0: "a" }, [3]));
    `,
  },
  {
    name: "concat-subclass-species.js",
    covers: "bun-syntax.def",
    source: `
      class SpeciesObject extends Array { static get [Symbol.species]() { return Object; } }
      class SpeciesUndefined extends Array { static get [Symbol.species]() { return undefined; } }
      class SpeciesInherited extends Array {}
      function concat(list, more) {
        const result = list.concat(more);
        return [Array.isArray(result), result.constructor.name, Object.keys(result).join(), result.length, result[2]];
      }
      report("species Object", () => concat(new SpeciesObject(1, 2), [3]));
      report("species undefined", () => concat(new SpeciesUndefined(1, 2), [3]));
      report("inherited species", () => concat(new SpeciesInherited(1, 2), [3]));
      report("ordinary array", () => concat([1, 2], [3]));
    `,
  },
  {
    name: "slice-with-undefined-end.ts",
    covers: "AOTArrayBuiltinEmitter.cpp",
    source: `
      function part(a: number[], start?: number, end?: number): number[] { return a.slice(start, end); }
      function partFromOne(a: number[], end: number | undefined): number[] { return a.slice(1, end); }
      const list = [10, 20, 30, 40];
      report("(1, undefined)", () => part(list, 1, undefined));
      report("(undefined, 2)", () => part(list, undefined, 2));
      report("(undefined, undefined)", () => part(list, undefined, undefined));
      report("(-2)", () => part(list, -2));
      report("(1, -1)", () => part(list, 1, -1));
      report("(9)", () => part(list, 9));
      report("(2, 1)", () => part(list, 2, 1));
      report("()", () => [part(list), part(list) === list]);
      report("constant start", () => [partFromOne(list, undefined), partFromOne(list, 3)]);
    `,
  },
  {
    name: "join-appended-in-loop.ts",
    covers: "AOTArrayBuiltinEmitter.cpp",
    source: `
      function joinNumbers(lists: number[][]): string { let s = ""; for (const a of lists) s += a.join(); return s; }
      function joinStrings(lists: string[][]): string { let s = ""; for (const a of lists) s += a.join(); return s; }
      function joinAnything(lists: unknown[][]): string {
        let s = "";
        try { for (const a of lists) s += a.join(); } catch { return "caught after " + s; }
        return s;
      }
      const unprintable = { toString(): string { throw new RangeError("no text"); } };
      report("numbers", () => [joinNumbers([[1, 2], [], [3.5, -0], [4]]), joinNumbers([[7]])]);
      report("strings", () => [joinStrings([["a", "b"], [""], ["c"]]), joinStrings([])]);
      report("mixed", () => joinAnything([[1, "a", null, undefined, true], [[2, 3], { toString: () => "object" }]]));
      report("toString throws", () => joinAnything([[1, 2], ["a", unprintable, "b"], [3]]));
      report("toString throws in the first list", () => joinAnything([[unprintable]]));
    `,
  },
  {
    name: "mapped-array-is-pristine.ts",
    covers: "AOTArrayIntrinsicEmitter.cpp",
    source: `
      function exercise(list: number[]): unknown {
        const popped = list.pop(), last = list.at(-1), length = list.push(7, 8);
        let sum = 0;
        for (const x of list) sum += x;
        list.length = 1;
        return [popped, last, length, sum, list];
      }
      function exerciseEach(a: number[]): unknown {
        const mapped = exercise(a.map(x => x * 2)), filtered = exercise(a.filter(x => x > 1));
        return [mapped, filtered, exercise(Array.from(a, x => x + 1)), exercise(a.slice(1))];
      }
      const seen: unknown[] = [];
      let earlier: number[] = [];
      function mapWhileWatching(a: number[]): unknown {
        const result = a.map((x, index, whole) => { seen.push(whole, earlier); return x + index + earlier.length; });
        const summary = [seen.length, seen.includes(result), seen.includes(a), result];
        earlier = result;
        return summary;
      }
      report("integers", () => exerciseEach([1, 2, 3, 4]));
      report("fractions", () => exerciseEach([1.5, 2.5, 3.5]));
      report("first watched call", () => mapWhileWatching([1, 2, 3]));
      report("second watched call", () => mapWhileWatching([4, 5]));
    `,
  },
  {
    name: "assign-own-proto-key.ts",
    covers: "AOTSimplifyBuiltinCalls.cpp",
    source: `
      function assign(source: any): any { return Object.assign({}, source); }
      function spread(source: any): any { return { ...source }; }
      function summarize(o: any): unknown {
        const prototype = Object.getPrototypeOf(o);
        return [show(o.x), Object.keys(o), Object.hasOwn(o, "__proto__"), prototype === Object.prototype];
      }
      function merge(a: { p: number; q: string }, b: { q: string; r: boolean }) { return Object.assign({}, a, b); }
      function gather(sources: Record<string, number>[]): Record<string, number> {
        const all: Record<string, number> = {};
        let index = 0;
        do { Object.assign(all, sources[index]); } while (++index < sources.length);
        return all;
      }
      const json = '{"__proto__": {"x": 1}}';
      report("assign", () => summarize(assign(JSON.parse(json))));
      report("spread", () => summarize(spread(JSON.parse(json))));
      report("assign without the key", () => summarize(assign({ x: 2 })));
      report("spread without the key", () => summarize(spread({ x: 2 })));
      report("two sources", () => merge({ p: 1, q: "a" }, { q: "b", r: true }));
      report("two other sources", () => merge({ p: 2, q: "c" }, { q: "d", r: false }));
      report("in a loop", () => [gather([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }]), gather([{ z: 0 }])]);
    `,
  },
  {
    name: "has-own-on-typed-objects.ts",
    covers: "AOTOwnPropertyEmitter.cpp",
    source: `
      type Point = { x: number; y?: number };
      function hasEach(p: Point): boolean[] {
        return [Object.hasOwn(p, "x"), Object.hasOwn(p, "y"), Object.hasOwn(p, "zzz"), Object.hasOwn(p, "extra")];
      }
      function changeFields(p: Point): unknown {
        const initial = hasEach(p);
        p.y = 2;
        const stored = hasEach(p);
        delete p.y;
        const withoutY = hasEach(p);
        delete (p as any).x;
        return [initial, stored, withoutY, hasEach(p), Object.keys(p)];
      }
      function addExtra(p: Point): Point { (p as any).extra = 1; return p; }
      const tag = Symbol("tag");
      type Tagged = { title: string; [tag]: number; size?: number };
      function listKeys(o: Tagged): unknown {
        const symbols = Object.getOwnPropertySymbols(o).map(String), all = Reflect.ownKeys(o).map(String);
        return [Object.keys(o), Object.getOwnPropertyNames(o), symbols, all];
      }
      report("point", () => changeFields({ x: 1 }));
      report("point created with y", () => changeFields({ x: 1, y: 5 }));
      report("point with an extra property", () => changeFields(addExtra({ x: 1 })));
      report("symbol field", () => listKeys({ title: "t", [tag]: 1 }));
      report("symbol field first", () => listKeys({ [tag]: 2, size: 3, title: "u" }));
    `,
  },
  {
    name: "own-property-cache-across-collections.js",
    covers: "AOTObjectBuiltinOperations.cpp",
    stressesCollector: true,
    source: `
      function has(o, k) { return Object.hasOwn(o, k); }
      function buildKey(head, tail) { return head + tail.slice(0); }
      function hasEach(o, parts) { return parts.map(([head, tail]) => has(o, buildKey(head, tail))); }
      function checkNames(o) {
        return [hasEach(o, [["na", "me"], ["no", "ne"]]), has(o, { toString: () => buildKey("na", "me") })];
      }
      function checkAroundStore(o) {
        const parts = [["k", "1"], ["k", "2"], ["ne", "w"]], before = hasEach(o, parts);
        o[buildKey("ne", "w")] = 1;
        const stored = hasEach(o, parts);
        delete o[buildKey("ne", "w")];
        return [before, stored, hasEach(o, parts)];
      }
      function createDictionary() {
        const o = {};
        for (let i = 0; i < 200; i++) o["k" + i] = i;
        for (let i = 0; i < 200; i += 2) delete o["k" + i];
        return o;
      }
      const subject = { name: 1, other: 2 };
      report("before a collection", () => checkNames(subject));
      Bun.gc(true);
      report("after a collection", () => checkNames(subject));
      report("ordinary object", () => checkAroundStore({ k1: 1 }));
      report("dictionary", () => checkAroundStore(createDictionary()));
      report("proxy", () => checkAroundStore(new Proxy({ k1: 1 }, {})));
      let found = 0;
      for (let round = 0; round < 500; round++) {
        const o = { name: round, ["k" + (round % 7)]: 1 };
        for (const answer of hasEach(o, [["na", "me"], ["k", String(round % 5)], ["oth", "er"]])) if (answer) found++;
      }
      report("500 rounds", () => found);
    `,
  },
  {
    name: "descriptors-field-by-field.ts",
    covers: "AOTObjectBuiltinOperations.cpp, AOTObjectBuiltinEmitter.cpp",
    source: `
      type Subject = { data: number; readonly computed: number };
      function make(): Subject { return { data: 1, get computed() { return 2; } }; }
      function readFields(o: unknown, k: string): unknown {
        const d = Object.getOwnPropertyDescriptor(o, k);
        const accessors = [typeof d?.get, d?.get?.call(o), typeof d?.set];
        return [d?.value, d?.writable, ...accessors, d?.enumerable, d?.configurable].map(show);
      }
      function getDescriptor(o: unknown, k: string) { return Object.getOwnPropertyDescriptor(o, k); }
      function listFields(o: unknown, k: string): unknown {
        const d = getDescriptor(o, k);
        return d === undefined ? "absent" : Object.keys(d);
      }
      function reflectValue(o: any, k: string): unknown { return Reflect.getOwnPropertyDescriptor(o, k)?.value; }
      for (const k of ["data", "computed", "missing"]) {
        report(k + ", field by field", () => readFields(make(), k));
        report(k + ", escaping", () => listFields(make(), k));
      }
      report("read-only", () => readFields(Object.defineProperty({}, "fixed", { value: 3 }), "fixed"));
      report("length of a string", () => readFields("ab", "length"));
      report("Reflect on an object", () => reflectValue(make(), "data"));
      report("Reflect on a number", () => reflectValue(1, "x"));
    `,
  },
  {
    name: "freeze-typed-objects.ts",
    covers: "AOTObjectBuiltinEmitter.cpp",
    source: `
      type Pair = { left: number; right: number };
      function create(): Pair { return { left: 1, right: 2 }; }
      function createFrozen(left: number, right: number) { return Object.freeze({ left, right }); }
      function createBare(k: number): any { const o = Object.create(null); o.k = k; return o; }
      function freeze(p: Pair): Pair { Object.freeze(p); return p; }
      function addExtra(p: Pair): Pair { (p as any).extra = 1; return p; }
      function store(p: Pair, value: number): number { p.left = value; return p.left; }
      function summarize(p: Readonly<Pair>): unknown { return [Object.isFrozen(p), p.left, p.right, Object.keys(p)]; }
      function summarizeAfterStore(p: Pair): unknown { try { store(p, 5); } catch {} return summarize(p); }
      function getPrototype(value: any): unknown { return Object.getPrototypeOf(value); }
      function reflectPrototype(value: any): unknown { return Reflect.getPrototypeOf(value); }
      report("not frozen", () => [store(create(), 5), summarizeAfterStore(create())]);
      report("frozen", () => summarize(freeze(create())));
      report("store to a frozen object", () => store(freeze(create()), 5));
      report("after that store", () => summarizeAfterStore(freeze(create())));
      report("delete from a frozen object", () => delete (freeze(create()) as any).left);
      report("frozen with an extra property", () => summarize(freeze(addExtra(create()))));
      report("store to the extra property", () => { (freeze(addExtra(create())) as any).extra = 2; });
      report("literal frozen at once", () => [summarize(createFrozen(1, 2)), summarize(createFrozen(3, 4))]);
      report("store to that literal", () => { (createFrozen(1, 2) as any).left = 5; });
      report("no prototype", () => [getPrototype(createBare(1)), Object.keys(createBare(2)), createBare(3).k]);
      report("getPrototypeOf", () => [getPrototype(1) === Number.prototype, getPrototype({}) === Object.prototype]);
      report("Reflect on an object", () => reflectPrototype({}) === Object.prototype);
      report("Reflect on a number", () => reflectPrototype(1));
    `,
  },
  {
    name: "assign-between-typed-objects.ts",
    covers: "AOTObjectAssignEmitter.cpp",
    source: `
      type Size = { width: number; height: number };
      type Limits = { title: string; limit?: number };
      type Letters = { a: number; b: number };
      class Meter {
        log: number[] = [];
        height = 0;
        set width(value: number) { this.log.push(value); }
      }
      function copySize(target: Size, source: Size): Size { return Object.assign(target, source); }
      function tryCopySize(target: Size, source: Size): unknown {
        try { copySize(target, source); } catch { return ["threw", target]; }
        return ["copied", target];
      }
      function copyLimits(target: Limits, source: Limits): unknown {
        const result = Object.assign(target, source);
        return [result === target, Object.keys(result), result.title, show(result.limit)];
      }
      function copyToMeter(target: Meter, source: Size): unknown {
        const meter = Object.assign(target, source);
        return [meter.log, meter.height, Object.keys(meter)];
      }
      function replaceA(o: Letters): Letters { return { ...o, a: 1 }; }
      function freezeSize(size: Size): Size { return Object.freeze(size); }
      function fixHeight(size: Size): Size { return Object.defineProperty(size, "height", { writable: false }); }
      function addDepth(size: Size): Size { (size as any).depth = 5; return size; }
      const source: Size = { width: 3, height: 4 };
      report("equal field types", () => copySize({ width: 1, height: 2 }, source));
      report("integers into fractions", () => copySize({ width: 1.5, height: 2.5 }, source));
      report("fractions into integers", () => copySize({ width: 1, height: 2 }, { width: 3.25, height: 4.75 }));
      report("frozen target", () => tryCopySize(freezeSize({ width: 1, height: 2 }), source));
      report("read-only second field", () => tryCopySize(fixHeight({ width: 1, height: 2 }), source));
      report("optional field absent", () => copyLimits({ title: "t", limit: 5 }, { title: "s" }));
      report("optional field present", () => copyLimits({ title: "t", limit: 5 }, { title: "s", limit: 9 }));
      report("optional field undefined", () => copyLimits({ title: "t", limit: 5 }, { title: "s", limit: undefined }));
      report("target field still unset", () => copyLimits({ title: "t" }, { title: "s", limit: 9 }));
      report("spread, then the same key", () => [replaceA({ a: 5, b: 6 }), Object.keys(replaceA({ a: 7, b: 8 }))]);
      report("setter on the target", () => copyToMeter(new Meter(), source));
      report("setter on another target", () => copyToMeter(new Meter(), { width: 5, height: 6 }));
      report("extra property on the source", () =>
        copySize({ width: 1, height: 2 }, addDepth({ width: 3, height: 4 })));
    `,
  },
  {
    name: "map-mutated-during-for-each.ts",
    covers: "AOTMapSetBuiltinEmitter.cpp",
    source: `
      function walkMap(map: Map<number, string>, change: (map: Map<number, string>, key: number) => void): unknown {
        const visited: number[] = [];
        map.forEach((_, key) => { visited.push(key); change(map, key); });
        return [visited.length, visited.slice(0, 6), visited.at(-1), map.size];
      }
      function walkSet(set: Set<number>, change: (set: Set<number>, key: number) => void): unknown {
        const visited: number[] = [];
        set.forEach(key => { visited.push(key); change(set, key); });
        return [visited.length, visited.slice(0, 6), visited.at(-1), set.size];
      }
      const createMap = () => new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]]);
      const createSet = () => new Set([1, 2, 3, 4]);
      report("map cleared", () => walkMap(createMap(), m => m.clear()));
      report("map refilled", () => walkMap(createMap(), (m, k) => { if (k === 1) { m.clear(); m.set(9, "i"); } }));
      report("map grown", () => walkMap(createMap(), m => { for (let n = 100; n < 200; n++) m.set(n, "n"); }));
      report("map without its next key", () => walkMap(createMap(), (m, k) => { m.delete(k + 1); }));
      report("map without its current key", () => walkMap(createMap(), (m, k) => { m.delete(k); }));
      report("set cleared", () => walkSet(createSet(), s => s.clear()));
      report("set refilled", () => walkSet(createSet(), (s, k) => { if (k === 1) { s.clear(); s.add(9); } }));
      report("set grown", () => walkSet(createSet(), s => { for (let n = 100; n < 200; n++) s.add(n); }));
      report("set without its next key", () => walkSet(createSet(), (s, k) => { s.delete(k + 1); }));
      report("set without its current key", () => walkSet(createSet(), (s, k) => { s.delete(k); }));
    `,
  },
  {
    name: "collections-from-iterables.ts",
    covers: "AOTMapSetBuiltinEmitter.cpp",
    source: `
      function createStringSet(list: string[]): Set<string> { return new Set(list); }
      function createMixedSet(list: (number | string)[]): Set<number | string> { return new Set(list); }
      function createSetFrom<T>(items: Iterable<T>): Set<T> { return new Set(items); }
      function createStringMap(pairs: [string, number][]): Map<string, number> { return new Map(pairs); }
      function createObjectMap(pairs: [object, number][]): Map<object, number> { return new Map(pairs); }
      function* yieldLetters(last: string): Generator<string> { yield "x"; yield "y"; yield "x"; yield last; }
      function summarize(...collections: (Set<unknown> | Map<unknown, unknown>)[]): unknown {
        return collections.map(collection => [collection.size, [...collection]]);
      }
      const key = {};
      report("strings", () => summarize(createStringSet(["b", "a", "b"]), createStringSet([])));
      report("number and string", () => summarize(createMixedSet([1, "a"]), createMixedSet(["1", 1, 1])));
      report("generator", () => summarize(createSetFrom(yieldLetters("z")), createSetFrom(yieldLetters("y"))));
      report("string keys", () =>
        summarize(createStringMap([["a", 1]]), createStringMap([["a", 1], ["b", 2], ["a", 3]])));
      report("object keys", () =>
        summarize(createObjectMap([[{}, 1]]), createObjectMap([[key, 1], [{}, 2], [key, 3]])));
    `,
  },
  {
    name: "generators-from-evaluated-text.js",
    covers: "AOTEngineBuiltinEmitter.cpp",
    evaluatesText: true,
    source: `
      const log = [];
      const note = entry => { log.push(entry); };
      const make = new Function("log", "return function*() { try { yield 1; yield 2; } finally { log('f'); } }");
      function* written() { try { yield 1; yield 2; } finally { note("f"); } }
      function resume(generatorFunction, resumeOnce) {
        log.length = 0;
        const g = generatorFunction(), steps = [g.next()];
        try { steps.push(resumeOnce(g)); } catch (error) { steps.push("threw " + error.constructor.name); }
        steps.push(log.join(), g.next(), log.join());
        return steps;
      }
      for (const [kind, generatorFunction] of [["text", make(note)], ["written", written]]) {
        report(kind + ": return", () => resume(generatorFunction, g => g.return(7)));
        report(kind + ": throw", () => resume(generatorFunction, g => g.throw(new RangeError("x"))));
        report(kind + ": next", () => resume(generatorFunction, g => g.next()));
      }
    `,
  },
  {
    name: "sloppy-call-receivers.cjs",
    covers: "AOTEngineBuiltinEmitter.cpp",
    source: `
      function self() { return this; }
      function strictSelf() { "use strict"; return this; }
      function callOn(f, receiver) { return f.call(receiver); }
      function valueOf(receiver) { return Object.prototype.valueOf.call(receiver); }
      function collect(iterable) { const seen = []; for (const value of iterable) seen.push(value); return seen; }
      function* countUp() { yield 1; yield 2; }
      function* countDown() { yield 2; yield 1; }
      let steps = 0;
      countUp.prototype.next = function () {
        return ++steps > 2 ? { done: true, value: undefined } : { done: false, value: "own next " + steps };
      };
      report("sloppy, no receiver", () => self() === globalThis);
      report("sloppy, undefined", () => [self.call(undefined) === globalThis, callOn(self, undefined) === globalThis]);
      report("sloppy, null", () => [self.call(null) === globalThis, callOn(self, null) === globalThis]);
      report("sloppy, 5", () => [typeof self.call(5), self.call(5) == 5, typeof callOn(self, 5), callOn(self, 5) == 5]);
      report("sloppy, s", () => [typeof self.call("s"), typeof callOn(self, "s"), callOn(self, "s") == "s"]);
      report("strict, no receiver", () => strictSelf());
      report("strict, direct", () => [strictSelf.call(undefined), strictSelf.call(null), strictSelf.call(5)].map(show));
      report("strict", () => [undefined, null, 5, "s"].map(receiver => show(callOn(strictSelf, receiver))));
      report("valueOf of null", () => valueOf(null));
      report("valueOf of undefined", () => valueOf(undefined));
      report("valueOf of a number", () => [typeof valueOf(5), valueOf(5) == 5]);
      report("own next", () => collect(countUp()));
      report("original next", () => collect(countDown()));
    `,
  },
  {
    name: "methods-returning-this-on-other-receivers.js",
    covers: "AOTObjectBuiltinEmitter.cpp",
    source: `
      const unique = Symbol("unique");
      function wrap(receiver) { return Object.prototype.valueOf.call(receiver); }
      function iteratorOf(receiver) { return Iterator.prototype[Symbol.iterator].call(receiver); }
      report("valueOf of 5", () => [typeof Object.prototype.valueOf.call(5), Object.prototype.valueOf.call(5) == 5]);
      report("valueOf of s", () => [typeof Object.prototype.valueOf.call("s"), Object.prototype.valueOf.call("s") == "s"]);
      report("valueOf of true", () => [typeof Object.prototype.valueOf.call(true), Object.prototype.valueOf.call(true) == true]);
      report("valueOf of a symbol", () => [typeof Object.prototype.valueOf.call(unique), Object.prototype.valueOf.call(unique) == unique]);
      report("valueOf of 1n", () => [typeof Object.prototype.valueOf.call(1n), Object.prototype.valueOf.call(1n) == 1n]);
      report("valueOf of undefined", () => Object.prototype.valueOf.call(undefined));
      report("valueOf of null", () => Object.prototype.valueOf.call(null));
      report("valueOf, untyped", () => [5, "s", true, unique, 1n].map(receiver => typeof wrap(receiver)));
      report("valueOf of an object", () => { const object = {}; return [Object.prototype.valueOf.call(object) === object, wrap(object) === object]; });
      report("iterator of undefined", () => Iterator.prototype[Symbol.iterator].call(undefined));
      report("iterator of null", () => Iterator.prototype[Symbol.iterator].call(null));
      report("iterator of 5", () => Iterator.prototype[Symbol.iterator].call(5));
      report("iterator, untyped", () => [undefined, null, 5, "s"].map(receiver => show(iteratorOf(receiver))));
      report("iterator of an iterator", () => { const values = [1].values(); return [values[Symbol.iterator]() === values, iteratorOf(values) === values]; });
    `,
  },
  {
    name: "one-method-two-names.js",
    covers: "string.def, typedarray.def: two ids for one function object made === fold to false",
    source: `
      function same(a, b) { return a === b; }
      const view = Uint8Array.of(1, 2);
      report("trimLeft", () => ["".trimLeft === "".trimStart, same("".trimLeft, "".trimStart)]);
      report("trimRight", () => ["".trimRight === "".trimEnd, same("".trimRight, "".trimEnd)]);
      report("trimLeft of the prototype", () => String.prototype.trimLeft === String.prototype.trimStart);
      report("trimRight of the prototype", () => String.prototype.trimRight === String.prototype.trimEnd);
      report("two trim functions", () => ["".trimLeft === "".trimEnd, same("".trimStart, "".trim)]);
      report("trim called", () => [" a ".trimLeft(), " a ".trimStart(), " a ".trimRight(), " a ".trimEnd()]);
      report("values", () => Uint8Array.prototype.values === Uint8Array.prototype[Symbol.iterator]);
      report("values of an instance", () => view.values === view[Symbol.iterator]);
      report("values, untyped", () => same(view.values, view[Symbol.iterator]));
      report("toString", () => Uint8Array.prototype.toString === Array.prototype.toString);
      report("toString of an instance", () => [view.toString === [].toString, same(view.toString, [].toString)]);
      report("values of another class", () => Uint8Array.prototype.values === Array.prototype.values);
      report("keys and values", () => [view.keys === view.values, same(view.keys, view.values)]);
      report("typed array called", () => [[...view.values()], [...view[Symbol.iterator]()], view.toString()]);
    `,
  },
  {
    name: "classes-of-allocated-results.js",
    covers: "typedarray.def, promise.def: the class of a copy of a Buffer, the keys of Promise.withResolvers()",
    source: `
      function summarize(bytes) {
        return [bytes instanceof Buffer, bytes instanceof Uint8Array, bytes.constructor.name, Array.from(bytes)];
      }
      function listKeys(o) { return Object.keys(o); }
      function changeKeys(o) { o.extra = 1; delete o.reject; return Object.keys(o); }
      report("toReversed", () => Buffer.from([1, 2]).toReversed() instanceof Buffer);
      report("toReversed, untyped", () => summarize(Buffer.from([1, 2]).toReversed()));
      report("toSorted", () => summarize(Buffer.from([2, 1]).toSorted()));
      report("with", () => summarize(Buffer.from([1, 2]).with(0, 9)));
      report("slice", () => summarize(Buffer.from([1, 2]).slice(1)));
      report("subarray", () => summarize(Buffer.from([1, 2]).subarray(1)));
      report("typed array", () => summarize(Uint8Array.of(1, 2).toReversed()));
      report("keys", () => [Object.keys(Promise.withResolvers()), listKeys(Promise.withResolvers())]);
      report("members", () => Object.values(Promise.withResolvers()).map(member => member.constructor.name));
      report("prototype", () => Object.getPrototypeOf(Promise.withResolvers()) === Object.prototype);
      report("changed keys", () => changeKeys(Promise.withResolvers()));
    `,
  },
];

runRegressions("built-in families", regressions);
