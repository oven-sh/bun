// Regression programs for lines of the built-ins table (aot/builtins/*.def in WebKit) that said less than the built-in does.
// Each program must print the same output compiled with --aot as it does under plain Bun.
import { type Regression, runRegressions } from "./family-regression-runner";

const regressions: Regression[] = [
  {
    name: "one-function-two-paths.js",
    covers: "two ids for one function object made === fold to false",
    source: `
      function same(a, b) { return a === b; }
      report("Number.parseInt", () => [Number.parseInt === parseInt, same(Number.parseInt, parseInt)]);
      report("Number.parseFloat", () => [Number.parseFloat === parseFloat, same(Number.parseFloat, parseFloat)]);
      report("calls", () => [Number.parseInt("12px"), parseInt("12px"), Number.parseFloat("1.5x"), parseFloat("1.5x")]);
      report("toGMTString", () => Date.prototype.toGMTString === Date.prototype.toUTCString);
      report("toGMTString called", () => [new Date(0).toGMTString(), new Date(0).toUTCString()]);
      report("dispose", () => DisposableStack.prototype.dispose === DisposableStack.prototype[Symbol.dispose]);
      report("disposeAsync", () =>
        AsyncDisposableStack.prototype.disposeAsync === AsyncDisposableStack.prototype[Symbol.asyncDispose]);
    `,
  },
  {
    name: "converted-array-operands.js",
    covers: "the conversion of an array operand runs toString of its elements",
    source: `
      const log = [];
      function key(text) { return { toString() { log.push(text); return text; } }; }
      function logged(probe) { log.length = 0; const value = probe(); return [value, log.join()]; }
      function storeBigInt(value) {
        const view = new DataView(new ArrayBuffer(8));
        view.setBigInt64(0, value);
        return String(view.getBigInt64(0));
      }
      report("Number", () => logged(() => Number([key("7")])));
      report("isNaN", () => logged(() => isNaN([key("x")])));
      report("new Date", () => logged(() => new Date([key("2020-01-02T00:00:00Z")]).getTime()));
      report("BigInt", () => logged(() => String(BigInt([key("9")]))));
      report("setBigInt64", () => logged(() => storeBigInt([key("5")])));
      report("Object.hasOwn", () => logged(() => [Object.hasOwn({ a: 1 }, [key("a")]), Object.hasOwn({ a: 1 }, [key("b")])]));
      report("new Error", () => logged(() => new Error([key("m")]).message));
      report("new Intl.NumberFormat", () => logged(() => new Intl.NumberFormat([key("en-US")]).format(1234.5)));
    `,
  },
  {
    name: "primitive-methods-on-objects.js",
    covers: "valueOf and toString of Number, Boolean and Symbol on a receiver that is no primitive",
    source: `
      function unwrap(wrapper) { return wrapper.valueOf(); }
      report("Number object", () => [new Number(5).valueOf() === 5, typeof new Number(5).valueOf(), unwrap(new Number(6))]);
      report("Boolean valueOf", () => Boolean.prototype.valueOf.call({}));
      report("Boolean toString", () => Boolean.prototype.toString.call({}));
      report("Symbol toString", () => Symbol.prototype.toString.call({}));
      report("after the throws", () => [true.valueOf(), false.toString(), Symbol.iterator.toString()]);
    `,
  },
  {
    name: "object-results-that-are-functions.js",
    covers: "`new Object` as the result of a call that can return a function",
    source: `
      class A {}
      class B extends A {}
      function f() { return 1; }
      const o = { x: 1 };
      report("Object(f)", () => [typeof Object(f), Object(f) === f, Object(f)(), typeof new Object(f)]);
      report("Object(o)", () => [Object(o) === o, new Object(o) === o, Object(5) === 5, typeof Object(5)]);
      report("Object.getPrototypeOf", () => [Object.getPrototypeOf(B) === A, typeof Object.getPrototypeOf(B)]);
      report("Reflect.getPrototypeOf", () => [Reflect.getPrototypeOf(B) === A, typeof Reflect.getPrototypeOf(B)]);
      report("proxy of a function", () => [typeof new Proxy(f, {}), new Proxy(f, {})()]);
      report("proxy of an object", () => [typeof new Proxy(o, {}), new Proxy(o, {}).x]);
    `,
  },
  {
    name: "reflect-construct-other-new-target.js",
    covers: "Reflect.construct linked a plain call: no instance, no new.target",
    source: `
      class C { constructor(x) { this.made = new.target.name + x; } }
      class D { only() { return "only on D: " + this.made; } }
      function construct(target, newTarget) { return Reflect.construct(target, [1], newTarget); }
      report("other new.target", () => [construct(C, D).only(), construct(C, D) instanceof D, construct(C, D) instanceof C]);
      report("same new.target", () => [construct(C, C).made, construct(C, C) instanceof C]);
      report("no new.target", () => Reflect.construct(C, [2]).made);
    `,
  },
  {
    name: "format-that-throws.ts",
    covers: "format of a number without `throws`",
    source: `
      const dates = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
      const numbers = new Intl.NumberFormat("en-US");
      function formatDate(time: number): string {
        try { return dates.format(time); } catch (error) { return "caught " + (error as Error).name; }
      }
      function formatNumber(value: number): string {
        try { return numbers.format(value); } catch (error) { return "caught " + (error as Error).name; }
      }
      report("dates", () => [formatDate(0), formatDate(NaN), formatDate(Infinity), formatDate(86400000)]);
      report("numbers", () => [formatNumber(0.5), formatNumber(NaN), formatNumber(-Infinity), formatNumber(-0)]);
    `,
  },
  {
    name: "json-callbacks-receive-new-objects.js",
    covers: "the reviver and the replacer receive objects that the built-in allocates",
    source: `
      const log = [];
      function revive(key, value) {
        log.push([key, JSON.stringify(this), JSON.stringify(value)]);
        if (key === "b") this.tagged = true;
        return value;
      }
      function replace(key, value) {
        log.push([key, Object.keys(this).join(), typeof value]);
        return key === "b" ? { replaced: value } : value;
      }
      report("reviver", () => { log.length = 0; return [JSON.parse('{"a":[1,{"b":2}]}', revive), log]; });
      report("replacer", () => { log.length = 0; return [JSON.stringify({ a: [1, { b: 2 }] }, replace), log]; });
    `,
  },
  {
    name: "create-with-value-getter.js",
    covers: "Object.create with descriptors is filled by what a `value` getter returns",
    source: `
      const held = { x: 1 };
      function create() { return Object.create(null, { a: { get value() { return held; }, enumerable: true } }); }
      report("first", () => { const made = create(); made.a.x++; return [made.a === held, held.x, Object.keys(made)]; });
      report("second", () => { const made = create(); made.a.x++; return [made.a === held, held.x]; });
    `,
  },
  {
    name: "to-locale-string-arguments.js",
    covers: "Array.prototype.toLocaleString passes its arguments to each element",
    source: `
      const locales = ["en-US"], options = { tag: 0 };
      const element = {
        toLocaleString(first, second) { second.tag++; return [first === locales, second === options].join(); },
      };
      report("one element", () => [[element].toLocaleString(locales, options), options.tag]);
      report("two elements", () => [[element, element].toLocaleString(locales, options), options.tag]);
    `,
  },
  {
    name: "iterator-helper-callbacks.js",
    covers: "the callbacks of Iterator.prototype.map, filter and flatMap receive the elements",
    source: `
      const item = { n: 1 };
      function bump(value) { value.n++; return value === item; }
      report("map", () => [[...[item].values().map(bump)], item.n]);
      report("filter", () => [[...[item].values().filter(bump)].length, item.n]);
      report("flatMap", () => [[...[item].values().flatMap(value => [bump(value), value.n])], item.n]);
      report("drop and take", () => [[...[1, 2, 3].values().drop(1)], [...[1, 2, 3].values().take(2)]]);
    `,
  },
  {
    name: "catch-calls-then.js",
    covers: "Promise.prototype.catch returns what `then` returns",
    source: `
      class Settled extends Promise { then() { return 5; } }
      function handle(promise) { return promise.catch(() => {}); }
      const changed = Promise.resolve(1);
      changed.then = () => "own then";
      report("subclass", () => [typeof handle(new Settled(() => {})), handle(new Settled(() => {}))]);
      report("own then", () => handle(changed));
      report("ordinary promise", () => [typeof handle(Promise.resolve(1)), handle(Promise.resolve(1)) instanceof Promise]);
    `,
  },
  {
    name: "weak-collections-from-generators.js",
    covers: "new WeakMap(x) and new WeakSet(x) are filled through the iteration protocol",
    source: `
      const a = {}, b = {};
      function* yieldPairs() { yield [a, 1]; yield [b, 2]; }
      function* yieldKeys() { yield a; yield b; }
      report("WeakMap", () => { const map = new WeakMap(yieldPairs()); return [map.get(a), map.get(b), map.has({})]; });
      report("WeakSet", () => { const set = new WeakSet(yieldKeys()); return [set.has(a), set.has(b), set.has({})]; });
      report("empty", () => [new WeakMap().has(a), new WeakSet().has(a)]);
    `,
  },
  {
    name: "borrowed-methods.js",
    covers:
      "AOTFlowSolverBuiltinCalls.cpp: the columns of a built-in hold for a receiver of its class, or for its holder",
    source: `
      const arrayLike = { length: 2 ** 53 - 2, push: Array.prototype.push };
      class Stack {
        constructor(length) { this.made = "made with " + length; }
        peek() { return [this.made, this.length, this[0]]; }
      }
      Stack.of = Array.of;
      Stack.from = Array.from;
      class Padded { toString() { return "  padded  "; } }
      Padded.prototype.trim = String.prototype.trim;
      report("push past 2 ** 32", () => [arrayLike.push(1), arrayLike.length]);
      report("Array.of on a class", () => Stack.of(7, 8).peek());
      report("Array.from on a class", () => Stack.from([9]).peek());
      report("trim on an object", () => new Padded().trim());
      report("on their own classes", () => [[1].push(2), Array.of(7, 8), Array.from([9]), "  s  ".trim()]);
    `,
  },
  {
    name: "names-defined-by-capture-stack-trace.js",
    covers:
      "Error.captureStackTrace defines originalLine and originalColumn beside stack where positions are mapped back to sources",
    source: `
      function capture() { const target = { a: 1 }; Error.captureStackTrace(target); return target; }
      function agrees(target, name) { return Object.getOwnPropertyNames(target).includes(name) === (target[name] !== undefined); }
      report("what a read finds is what the object has", () => {
        const target = capture();
        return [agrees(target, "stack"), agrees(target, "originalLine"), agrees(target, "originalColumn")];
      });
      report("the rest of the object", () => { const target = capture(); return [Object.keys(target), typeof target.stack, target.a]; });
    `,
  },
  {
    name: "getters-run-by-structured-clone.js",
    covers: "structuredClone runs the getters of an object literal and of what an array holds",
    source: `
      let count = 0;
      function countAcross(create) { const source = create(); const before = count; const copy = structuredClone(source); return [count - before, copy]; }
      report("a literal with a getter", () => countAcross(() => ({ a: 1, get g() { return ++count; } })));
      report("an array of literals with getters", () => countAcross(() => [{ get g() { return ++count; } }, { get g() { return ++count; } }]));
      report("a getter one level down", () => countAcross(() => ({ inner: { get g() { return ++count; } } })));
      report("plain data", () => countAcross(() => ({ a: [1, "b", null], c: { d: true } })));
    `,
  },
  {
    name: "object-made-by-from-entries.js",
    covers:
      "the object that the compiled code of Object.fromEntries makes is the instance of Object that the table declares",
    source: `
      function* generated() { yield ["g", 1]; yield [Symbol.iterator, 2]; }
      const iterable = { [Symbol.iterator]() { return [["i", 1]][Symbol.iterator](); } };
      report("an array of pairs", () => Object.fromEntries([["first", 1], ["second", "two"]]));
      report("a map", () => Object.fromEntries(new Map([["a", 1], ["b", 2]])));
      report("a generator", () => { const made = Object.fromEntries(generated()); return [made.g, made[Symbol.iterator]]; });
      report("an iterable", () => Object.fromEntries(iterable));
      report("no pairs", () => [Object.keys(Object.fromEntries([])), Object.getPrototypeOf(Object.fromEntries([])) === Object.prototype]);
      report("index keys and a repeated key", () => Object.fromEntries([[1, "a"], ["0", "b"], [1, "c"]]));
      report("what it made is an ordinary object", () => { const made = Object.fromEntries([["a", 1]]); made.b = 2; delete made.a; return made; });
      report("an entry that is no object", () => Object.fromEntries([1]));
      report("Object.groupBy", () => { const groups = Object.groupBy([1, 2, 3], n => (n % 2 ? "odd" : "even")); return [groups, Object.getPrototypeOf(groups)]; });
    `,
  },
];

runRegressions("lines of the built-ins table", regressions);
