// Object.getOwnPropertyDescriptor, Object.defineProperty, the same two of Reflect, a test for an own property and the receiver of
// Reflect.set reach two traps of a proxy: getOwnPropertyDescriptor and defineProperty. The compiler follows the proxy through them, so
// what the traps get and what they answer has to be what plain Bun hands them, and a program that does no more than this to a proxy
// uses no more of the built-ins than it names. JSON.stringify asks a proxy by get, ownKeys and getOwnPropertyDescriptor in the same way.
// console.log prints the target of a proxy and asks nothing. Each scene has a proxy and a handler of its own.
//
// Behind its text a scene has what it says: how it ended, and the lines that it logged, as the program of all scenes prints them behind
// the name of the scene. A scene that prints through console itself has behind that what console writes for it, to stdout and to stderr.
// Plain Bun has to say that, and so has the compiled program.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
import { withThreads } from "./harness/flags";
import { sayGoal } from "./harness/goals";
import { test } from "./supported";

const scenes: [name: string, does: string, says: string, stdout?: string, stderr?: string][] = [
  [
    "the answer holds what the trap's answer holds",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor(t, k) { log("describe", k); return { value: { mark: "made by the trap" }, configurable: true }; } });
     const d = Object.getOwnPropertyDescriptor(proxy, "a");
     log(d.value.mark, d.writable, d.enumerable, d.configurable, Object.keys(d));`,
    "returned: describe a | made by the trap false false true [value,writable,enumerable,configurable]",
  ],
  [
    "the answer holds the accessors that the trap answers",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor(t, k) { return { get() { return "got by " + typeof this; }, set(v) { log("set", v); }, configurable: true }; } });
     const d = Reflect.getOwnPropertyDescriptor(proxy, "a");
     log(d.get(), d.set("x"), Object.keys(d));`,
    "returned: set x | got by object undefined [get,set,enumerable,configurable]",
  ],
  [
    "a trap that answers nothing",
    `const proxy = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { log("describe", k); } });
     log(Object.getOwnPropertyDescriptor(proxy, "a"), Object.hasOwn(proxy, "a"));`,
    "returned: describe a | describe a | undefined false",
  ],
  [
    "a getter of the trap's answer runs",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return { get value() { log("value is read"); return { mark: "from the getter" }; }, configurable: true }; } });
     log(Object.getOwnPropertyDescriptor(proxy, "a").value.mark);`,
    "returned: value is read | from the getter",
  ],
  [
    "what was described is defined elsewhere under the same key",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return { value: { mark: "described" }, configurable: true, enumerable: true }; } });
     const other = {};
     Object.defineProperty(other, "a", Object.getOwnPropertyDescriptor(proxy, "a"));
     log(other.a.mark, Object.keys(other));`,
    "returned: described [a]",
  ],
  [
    "a field of the target that only the trap's built-in sees",
    `const target = { hidden: { mark: "on the target" }, other: 2 };
     const proxy = new Proxy(target, { getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); } });
     log(Object.getOwnPropertyDescriptor(proxy, "hidden").value.mark, Object.hasOwn(proxy, "other"), Object.hasOwn(proxy, "none"));`,
    "returned: on the target true false",
  ],
  [
    "the trap gets a descriptor of the engine's own",
    `let kept;
     const proxy = new Proxy({}, { defineProperty(t, k, d) { kept = d; log("define", k, Object.keys(d), "get" in d, d.value.mark, d.writable, d.enumerable, d.configurable); return true; } });
     const given = { value: { mark: "given" }, enumerable: true, extra: 1 };
     log(Object.defineProperty(proxy, "a", given) === proxy, kept === given, Object.getPrototypeOf(kept) === Object.prototype, kept.extra);`,
    "returned: define a [value,enumerable] false given undefined true undefined | true false true undefined",
  ],
  [
    "a trap that writes to its descriptor leaves the program's alone",
    `const proxy = new Proxy({}, { defineProperty(t, k, d) { d.value = { mark: "written by the trap" }; d.more = 1; return true; } });
     const given = { value: { mark: "given" }, configurable: true };
     Reflect.defineProperty(proxy, "a", given);
     log(given.value.mark, Object.keys(given));`,
    "returned: given [value,configurable]",
  ],
  [
    "the value that is defined goes where the trap puts it",
    `const side = {};
     const proxy = new Proxy({}, { get(t, k) { return side[k]; }, defineProperty(t, k, d) { side[k] = d.value; return true; } });
     Object.defineProperty(proxy, "a", { value: { mark: "through the trap" }, configurable: true });
     log(proxy.a.mark, side.a.mark);`,
    "returned: through the trap through the trap",
  ],
  [
    "the accessors that are defined reach the trap",
    `const proxy = new Proxy({}, { defineProperty(t, k, d) { log(Object.keys(d), d.get(), d.set("y")); return true; } });
     Object.defineProperty(proxy, "a", { get() { return "the getter ran"; }, set(v) { log("the setter got", v); }, configurable: true });`,
    "returned: the setter got y | [get,set,configurable] the getter ran undefined",
  ],
  [
    "the proxy that Object.defineProperty answers is the proxy",
    `const proxy = new Proxy({ a: "of the target" }, { get(t, k) { log("get", k); return t[k]; }, defineProperty() { return true; } });
     log(Object.defineProperty(proxy, "b", { value: 1, configurable: true }).a);`,
    "returned: get a | of the target",
  ],
  [
    "a trap that refuses",
    `const proxy = new Proxy({}, { defineProperty() { return false; } });
     log(Reflect.defineProperty(proxy, "a", { value: 1 }));
     Object.defineProperty(proxy, "a", { value: 1 });`,
    "TypeError: false",
  ],
  [
    "a trap that throws",
    `const proxy = new Proxy({}, { defineProperty() { throw { mark: "thrown by define" }; }, getOwnPropertyDescriptor() { throw { mark: "thrown by describe" }; } });
     try { Object.defineProperty(proxy, "a", { value: 1 }); } catch (e) { log(e.mark); }
     try { Object.getOwnPropertyDescriptor(proxy, "a"); } catch (e) { log(e.mark); }
     try { Object.hasOwn(proxy, "a"); } catch (e) { log(e.mark); }
     try { Reflect.set({}, "a", 1, proxy); } catch (e) { log(e.mark); }`,
    "returned: thrown by define | thrown by describe | thrown by describe | thrown by describe",
  ],
  [
    "Reflect.set asks its receiver what is there and defines the value",
    `const proxy = new Proxy({}, {
       getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); },
       defineProperty(t, k, d) { log("define", k, Object.keys(d), d.value.mark); return Reflect.defineProperty(t, k, d); },
     });
     log(Reflect.set({}, "a", { mark: "first" }, proxy));
     log(Reflect.set({}, "a", { mark: "second" }, proxy));
     log(Object.getOwnPropertyDescriptor(proxy, "a").value.mark);`,
    "returned: describe a | define a [value,writable,enumerable,configurable] first | true | describe a | define a [value] second | true | describe a | second",
  ],
  [
    "a setter that Reflect.set finds runs for the proxy",
    `const proxy = new Proxy({ name: "the target" }, { get(t, k) { log("get", k); return t[k]; }, getOwnPropertyDescriptor() { log("describe"); }, defineProperty() { log("define"); return true; } });
     log(Reflect.set({ set a(v) { log("setter", v, this === proxy, this.name); } }, "a", 1, proxy));`,
    "returned: get name | setter 1 true the target | true",
  ],
  [
    "a store on the proxy and on its heir",
    `const values = {};
     const proxy = new Proxy(values, {
       get(t, k) { return t[k]; },
       set(t, k, v, r) { if (r !== proxy) return Reflect.set({ __proto__: null }, k, v, r); t[k] = String(v).toUpperCase(); return true; },
       getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); },
       defineProperty(t, k, d) { log("define", k); t[k] = "defined " + d.value; return true; },
     });
     proxy.a = "stored";
     const heir = Object.create(proxy);
     heir.b = "of the heir";
     log(proxy.a, proxy.b, heir.a, heir.b, Object.keys(heir), Object.keys(values));
     log(Reflect.set(proxy, "c", "for another proxy", new Proxy({}, { defineProperty(t, k, d) { log("the other defines", k, d.value); return true; }, getOwnPropertyDescriptor() {} })));`,
    "returned: STORED undefined STORED of the heir [b] [a] | the other defines c for another proxy | true",
  ],
  [
    "a store under a key of the command line",
    `const values = {};
     const proxy = new Proxy(values, {
       get(t, k) { return t[k]; },
       set(t, k, v, r) { if (r !== proxy) return Reflect.set({ __proto__: null }, k, v, r); t[k] = String(v); return true; },
       getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); },
       defineProperty(t, k, d) { t[k] = String(d.value); return true; },
     });
     proxy[process.argv[2] ?? "a"] = 1;
     log(proxy.a, Object.keys(values));`,
    "returned: 1 [a]",
  ],
  [
    "the three tests for an own property",
    `const proxy = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { log("describe", k); return k === "made" ? { value: 1, configurable: true, enumerable: false } : Reflect.getOwnPropertyDescriptor(t, k); } });
     log(Object.hasOwn(proxy, "a"), Object.hasOwn(proxy, "made"), Object.hasOwn(proxy, "none"));
     log(Object.prototype.hasOwnProperty.call(proxy, "a"), Object.prototype.hasOwnProperty.call(proxy, "none"));
     log(Object.prototype.propertyIsEnumerable.call(proxy, "a"), Object.prototype.propertyIsEnumerable.call(proxy, "made"));
     log({}.hasOwnProperty.call(proxy, Symbol.iterator));`,
    "returned: describe a | describe made | describe none | true true false | describe a | describe none | true false | describe a | describe made | true false | describe Symbol(Symbol.iterator) | false",
  ],
  [
    "a handler without the trap hands the question on to the target",
    `const target = { a: { mark: "of the target" } };
     const proxy = new Proxy(target, { get(t, k) { return t[k]; } });
     log(Object.getOwnPropertyDescriptor(proxy, "a").value.mark, Object.hasOwn(proxy, "a"));
     Object.defineProperty(proxy, "b", { value: { mark: "defined through" }, enumerable: true });
     log(target.b.mark, Object.keys(target));
     log(Reflect.set({}, "c", { mark: "set through" }, proxy), target.c.mark);`,
    "returned: of the target true | defined through [a,b] | true set through",
  ],
  [
    "a trap that is put there later",
    `const handler = {};
     const proxy = new Proxy({ a: 1 }, handler);
     log(Object.getOwnPropertyDescriptor(proxy, "a").value);
     handler.getOwnPropertyDescriptor = () => ({ value: { mark: "from the later trap" }, configurable: true, writable: true, enumerable: true });
     handler.defineProperty = (t, k, d) => { log("the later trap defines", d.value); return true; };
     log(Object.getOwnPropertyDescriptor(proxy, "a").value.mark);
     Object.defineProperty(proxy, "a", { value: 2 });`,
    "returned: 1 | from the later trap | the later trap defines 2",
  ],
  [
    "traps that are built-ins",
    `const target = {};
     const proxy = new Proxy(target, { getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor, defineProperty: Reflect.defineProperty });
     Object.defineProperty(proxy, "a", { value: { mark: "by Reflect" }, configurable: true });
     log(target.a.mark, Object.getOwnPropertyDescriptor(proxy, "a").value.mark, Reflect.set({}, "b", { mark: "set" }, proxy), target.b.mark);`,
    "returned: by Reflect by Reflect true set",
  ],
  [
    "a proxy of a proxy",
    `const inner = new Proxy({}, { getOwnPropertyDescriptor(t, k) { log("inner describes", k); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log("inner defines", k, d.value.mark); return Reflect.defineProperty(t, k, d); } });
     const outer = new Proxy(inner, { getOwnPropertyDescriptor(t, k) { log("outer describes", k); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log("outer defines", k); return Reflect.defineProperty(t, k, d); } });
     Object.defineProperty(outer, "a", { value: { mark: "through both" }, configurable: true });
     log(Object.getOwnPropertyDescriptor(outer, "a").value.mark);`,
    "returned: outer defines a | inner defines a through both | inner describes a | outer describes a | inner describes a | inner describes a | through both",
  ],
  [
    "what the engine holds against the target",
    `const target = {};
     Object.defineProperty(target, "fixed", { value: 1 });
     const proxy = new Proxy(target, { getOwnPropertyDescriptor() {}, defineProperty() { return true; } });
     try { Object.getOwnPropertyDescriptor(proxy, "fixed"); } catch (e) { log(e.constructor.name); }
     try { Object.defineProperty(proxy, "none", { value: 1, configurable: false }); } catch (e) { log(e.constructor.name); }
     try { Object.defineProperty(proxy, "fixed", { value: 2 }); } catch (e) { log(e.constructor.name); }
     log(Object.getOwnPropertyDescriptor(proxy, "none"));
     const closed = Object.preventExtensions({ a: 1 });
     const overClosed = new Proxy(closed, { getOwnPropertyDescriptor() {}, defineProperty() { return true; } });
     try { Object.hasOwn(overClosed, "a"); } catch (e) { log(e.constructor.name); }
     try { Object.defineProperty(overClosed, "b", { value: 1 }); } catch (e) { log(e.constructor.name); }`,
    "returned: TypeError | TypeError | TypeError | undefined | TypeError | TypeError",
  ],
  [
    "a key that is converted",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor(t, k) { log("describe", typeof k, k); }, defineProperty(t, k, d) { log("define", typeof k, k); return true; } });
     const key = { toString() { log("the key is converted"); return "made"; } };
     Object.getOwnPropertyDescriptor(proxy, key);
     Object.defineProperty(proxy, key, {});
     Object.hasOwn(proxy, 1);
     Reflect.set({}, Symbol.for("s"), 1, proxy);`,
    "returned: the key is converted | describe string made | the key is converted | define string made | describe string 1 | describe symbol Symbol(s) | define symbol Symbol(s)",
  ],
  [
    "JSON.stringify lists the proxy and reads what it lists",
    `const proxy = new Proxy({ a: { mark: "of the target" }, b: 2 }, {
       get(t, k) { log("get", k); return k === "made" ? { mark: "made by get" } : t[k]; },
       ownKeys(t) { log("ownKeys"); return [...Reflect.ownKeys(t), "made"]; },
       getOwnPropertyDescriptor(t, k) { log("describe", k); return k === "made" ? { value: 1, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k); },
     });
     log(JSON.stringify(proxy), JSON.stringify({ inside: proxy }, null, 1).length);`,
    'returned: get toJSON | ownKeys | describe a | describe b | describe made | get a | get b | get made | get toJSON | ownKeys | describe a | describe b | describe made | get a | get b | get made | {"a":{"mark":"of the target"},"b":2,"made":{"mark":"made by get"}} 111',
  ],
  [
    "JSON.stringify calls the toJSON that get answers, on the proxy",
    `const proxy = new Proxy({ a: 1 }, { get(t, k) { log("get", k); return k === "toJSON" ? function (key) { log("toJSON", key, this === proxy); return { mark: "from toJSON" }; } : t[k]; } });
     log(JSON.stringify(proxy), JSON.stringify([proxy]));`,
    'returned: get toJSON | toJSON  true | get toJSON | toJSON 0 true | {"mark":"from toJSON"} [{"mark":"from toJSON"}]',
  ],
  [
    "JSON.stringify goes on to what the traps answer",
    `const inner = { toJSON() { log("the inner toJSON runs"); return "inner"; } };
     const proxy = new Proxy({}, { get(t, k) { return k === "x" ? inner : undefined; }, ownKeys() { return ["x"]; }, getOwnPropertyDescriptor() { return { value: 0, enumerable: true, configurable: true }; } });
     log(JSON.stringify(proxy));`,
    'returned: the inner toJSON runs | {"x":"inner"}',
  ],
  [
    "JSON.stringify of a proxy of a list",
    `const proxy = new Proxy([{ mark: "first" }, 2], { get(t, k) { log("get", k); return t[k]; } });
     log(JSON.stringify(proxy));`,
    'returned: get toJSON | get length | get 0 | get 1 | [{"mark":"first"},2]',
  ],
  [
    "JSON.stringify without a trap lists the target",
    `const target = { seen: { mark: "only by JSON" }, get computed() { log("the getter runs for", this === proxy); return 1; } };
     const proxy = new Proxy(target, {});
     log(JSON.stringify(proxy));`,
    'returned: the getter runs for true | {"seen":{"mark":"only by JSON"},"computed":1}',
  ],
  [
    "JSON.stringify with a function or a list beside the proxy",
    `const proxy = new Proxy({ a: 1, b: 2 }, { get(t, k) { log("get", k); return t[k]; }, ownKeys(t) { log("ownKeys"); return Reflect.ownKeys(t); } });
     log(JSON.stringify(proxy, (key, value) => { log("replacer", key, value === proxy); return value; }));
     log(JSON.stringify(proxy, ["b"]));`,
    'returned: get toJSON | replacer  true | ownKeys | get a | replacer a false | get b | replacer b false | {"a":1,"b":2} | get toJSON | get b | {"b":2}',
  ],
  [
    "a trap that throws while JSON.stringify lists",
    `const proxy = new Proxy({ a: 1 }, { ownKeys() { throw { mark: "thrown by ownKeys" }; } });
     try { JSON.stringify(proxy); } catch (e) { log(e.mark); }`,
    "returned: thrown by ownKeys",
  ],
  [
    "console.log prints the target and asks no trap",
    `const seen = [];
     const proxy = new Proxy({ a: { mark: "of the target" }, onlyPrinted: 2 }, {
       get(t, k) { seen.push("get " + String(k)); return t[k]; },
       has(t, k) { seen.push("has " + String(k)); return k in t; },
       ownKeys(t) { seen.push("ownKeys"); return Reflect.ownKeys(t); },
       getOwnPropertyDescriptor(t, k) { seen.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
       getPrototypeOf(t) { seen.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); },
     });
     console.log(proxy);
     console.log("a text", proxy, 1);
     console.log({ inside: proxy }, [proxy]);
     console.error(proxy);
     console.info(proxy);
     console.warn(proxy);
     console.debug(proxy);
     log(seen);`,
    "returned: []",
    `{
  a: {
    mark: "of the target",
  },
  onlyPrinted: 2,
}
a text {
  a: {
    mark: "of the target",
  },
  onlyPrinted: 2,
} 1
{
  inside: {
    a: {
      mark: "of the target",
    },
    onlyPrinted: 2,
  },
} [
  {
    a: {
      mark: "of the target",
    },
    onlyPrinted: 2,
  }
]
{
  a: {
    mark: "of the target",
  },
  onlyPrinted: 2,
}
{
  a: {
    mark: "of the target",
  },
  onlyPrinted: 2,
}
`,
    `{
  a: {
    mark: "of the target",
  },
  onlyPrinted: 2,
}
{
  a: {
    mark: "of the target",
  },
  onlyPrinted: 2,
}
`,
  ],
  [
    "console.log calls what the target has for the formatter",
    `const target = { a: 1 };
     target[Symbol.for("nodejs.util.inspect.custom")] = function () { log("the target's own printer runs for the target", this === target); return { printed: { mark: "by the target" } }; };
     const proxy = new Proxy(target, { get(t, k) { log("get", k); return t[k]; } });
     console.log(proxy);
     console.log(new Proxy(proxy, {}));`,
    "returned: the target's own printer runs for the target true | the target's own printer runs for the target true",
    `{
  printed: {
    mark: "by the target",
  },
}
{
  printed: {
    mark: "by the target",
  },
}
`,
  ],
  [
    "a text with a % converts the proxy behind it",
    `const proxy = new Proxy({ a: 1 }, {
       get(t, k) { log("get", k); return k === "toString" ? () => "converted" : k === Symbol.toPrimitive ? undefined : t[k]; },
       ownKeys(t) { log("ownKeys"); return Reflect.ownKeys(t); },
       getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); },
     });
     console.log("%s", proxy);
     console.log("%j", proxy);
     console.log("%o and %d", proxy, proxy);`,
    "returned: get Symbol(Symbol.toPrimitive) | get toString | get toJSON | ownKeys | describe a | get a | get Symbol(Symbol.toPrimitive) | get valueOf | get toString",
    `converted
{"a":1}
{
  a: 1,
} and NaN
`,
  ],
  [
    "a text of the command line in front of a proxy",
    `const proxy = new Proxy({ a: 1 }, { get(t, k) { log("get", k); return k === "toString" ? () => "converted" : k === Symbol.toPrimitive ? undefined : t[k]; } });
     console.log(process.argv[2] ?? "%s", proxy);`,
    "returned: get Symbol(Symbol.toPrimitive) | get toString",
    `converted
`,
  ],
  [
    "console.dir and console.table of a proxy",
    `const proxy = new Proxy({ a: 1, b: { c: 2 } }, { get(t, k) { log("get", k); return t[k]; }, ownKeys(t) { log("ownKeys"); return Reflect.ownKeys(t); } });
     console.dir(proxy);
     console.dir({ a: { b: { c: {} } } }, new Proxy({ depth: 0 }, { get(t, k) { log("the options are asked for", k); return t[k]; } }));
     console.table(proxy);`,
    "returned: the options are asked for depth | the options are asked for colors | get Symbol(Symbol.iterator) | ownKeys | get a | get b",
    `{
  a: 1,
  b: {
    c: 2,
  },
}
{
  a: [Object ...],
}
┌───┬───┬────────┐
│   │ c │ Values │
├───┼───┼────────┤
│ a │   │ 1      │
│ b │ 2 │        │
└───┴───┴────────┘
`,
  ],
  [
    "the methods of Object.prototype that only look at their receiver",
    `const proxy = new Proxy({ a: 1 }, { get(t, k) { log("get", k); return k === Symbol.toStringTag ? "Tagged" : Reflect.get(t, k); }, getPrototypeOf(t) { log("getPrototypeOf"); return Reflect.getPrototypeOf(t); } });
     log(Object.prototype.valueOf.call(proxy) === proxy, Object.prototype.valueOf.call(proxy).a);
     log(Object.prototype.toString.call(proxy));
     log(Object.prototype.isPrototypeOf.call(proxy, {}), Object.prototype.isPrototypeOf.call(proxy, Object.create(proxy)));
     log(Object.prototype.toLocaleString.call(proxy));
     log(proxy.valueOf() === proxy, proxy.toString(), typeof Object.call(proxy, "x"));`,
    "returned: get a | true 1 | get Symbol(Symbol.toStringTag) | [object Tagged] | false true | get toString | get Symbol(Symbol.toStringTag) | [object Tagged] | get valueOf | get toString | get Symbol(Symbol.toStringTag) | true [object Tagged] object",
  ],
  [
    "__defineGetter__ and __defineSetter__ reach the trap that defines",
    `const proxy = new Proxy({}, { defineProperty(t, k, d) { log("define", k, Object.keys(d), d.get && d.get(), d.set && d.set("given")); return Reflect.defineProperty(t, k, d); } });
     Object.prototype.__defineGetter__.call(proxy, "a", () => "the getter ran");
     Object.prototype.__defineSetter__.call(proxy, "b", value => { log("the setter got", value); });
     log(proxy.a);
     Object.prototype.__defineGetter__.call(proxy, "c");`,
    "TypeError: define a [get,enumerable,configurable] the getter ran undefined | the setter got given | define b [set,enumerable,configurable] undefined undefined | the getter ran",
  ],
  [
    "__lookupGetter__ and __lookupSetter__ ask the trap that describes and go on above",
    `const above = { get inherited() { return "from above"; }, set inherited(v) {} };
     const target = Object.create(above, { own: { get() { return "of the target"; }, configurable: true } });
     const proxy = new Proxy(target, { getOwnPropertyDescriptor(t, k) { log("describe", k); return k === "made" ? { get() { return "made by the trap"; }, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k); } });
     log(Object.prototype.__lookupGetter__.call(proxy, "made")(), Object.prototype.__lookupGetter__.call(proxy, "own")(), Object.prototype.__lookupGetter__.call(proxy, "inherited")());
     log(typeof Object.prototype.__lookupSetter__.call(proxy, "inherited"), Object.prototype.__lookupSetter__.call(proxy, "none"));
     const elsewhere = new Proxy({}, { getPrototypeOf() { log("getPrototypeOf"); return above; } });
     log(Object.prototype.__lookupGetter__.call(elsewhere, "inherited")());`,
    "returned: describe made | describe own | describe inherited | made by the trap of the target from above | describe inherited | describe none | function undefined | getPrototypeOf | from above",
  ],
  [
    "the methods of Function.prototype refuse a proxy of what is no function",
    `const proxy = new Proxy({}, { get(t, k) { log("get", k); return t[k]; }, getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); }, getPrototypeOf(t) { log("getPrototypeOf"); return Reflect.getPrototypeOf(t); } });
     for (const method of [Function.prototype.bind, Function.prototype.call, Function.prototype.apply, Function.prototype.toString]) {
       try { method.call(proxy); } catch (e) { log(e.constructor.name); }
     }
     log(Function.prototype[Symbol.hasInstance].call(proxy, {}));`,
    "returned: TypeError | TypeError | TypeError | TypeError | false",
  ],
  [
    "a proxy of a function is bound, called and printed",
    `const proxy = new Proxy(function named(a, b) { return "called with " + a; }, { get(t, k) { log("get", k); return t[k]; }, getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); }, apply(t, s, l) { log("apply", l); return Reflect.apply(t, s, l); } });
     const bound = Function.prototype.bind.call(proxy, null, "the bound operand");
     log(bound(), bound.name, bound.length, Function.prototype.call.call(proxy, null, "x"), typeof Function.prototype.toString.call(proxy));`,
    "returned: describe length | get length | get name | apply [the bound operand] | apply [x] | called with the bound operand bound named 1 called with x string",
  ],
  [
    "a get that answers under the name in upper case",
    `const values = { A: "b" };
     values.toJSON = () => ({ A: values.A, by: "toJSON" });
     const proxy = new Proxy(values, {
       get(t, k) { if (typeof k !== "string") return values[k]; const upper = k.toUpperCase(); if (upper in values) return values[upper]; return values[k]; },
       ownKeys() { return ["A"]; },
       getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); },
     });
     log(proxy.a, proxy.hasOwnProperty("A"), proxy.hasOwnProperty("a"), JSON.stringify(proxy), proxy.toString(), proxy.valueOf() === proxy);`,
    'returned: describe A | describe a | b true false {"A":"b","by":"toJSON"} [object Object] true',
  ],
  [
    "a trap's answer that is no object",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return 1; } });
     try { Object.getOwnPropertyDescriptor(proxy, "a"); } catch (e) { log(e.constructor.name); }`,
    "returned: TypeError",
  ],
];

/** How a scene ended, and the lines that it logged. */
function saidBy(says: string) {
  const behindEnd = says.indexOf(": ");
  if (behindEnd === -1) throw new Error(`${JSON.stringify(says)} does not say how the scene ended`);
  const logged = says.slice(behindEnd + 2);
  return { ended: says.slice(0, behindEnd), logged: logged ? logged.split(" | ") : [] };
}

/**
 * What a program printed, without the lines that its scene logged: what console itself wrote. Where the line of a trap falls between what
 * console writes for the call that asked it is console's own matter, so a line is looked for anywhere behind the last one, also in the
 * middle of a line of console. A line that is not there is named in front of the text.
 */
function withoutLogged(stdout: string, logged: string[]) {
  let at = 0;
  for (const line of logged) {
    at = stdout.indexOf(line + "\n", at);
    if (at === -1) return `${JSON.stringify(line)} is not logged behind the lines before it:\n${stdout}`;
    stdout = stdout.slice(0, at) + stdout.slice(at + line.length + 1);
  }
  return stdout;
}

const program = `
const lines = [];
function show(value) {
  if (typeof value === "symbol") return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function scene(name, run) {
  const said = [];
  let ended = "returned";
  try {
    run((...list) => { said.push(list.map(show).join(" ")); });
  } catch (error) {
    ended = error.constructor.name;
  }
  lines.push(name + ": " + ended + ": " + said.join(" | "));
}
${scenes.map(([name, does]) => `scene(${JSON.stringify(name)}, log => {\n${does}\n});`).join("\n")}
await 0;
for (const line of lines) console.log(line);
`;

// The program of all scenes is built as anybody builds it. The programs of one scene ask what compiled code does, and nothing of the
// file that holds it or of the threads that made it. So each is built as run-parallel.ts builds a stored program:
// - on one thread, for the slot that its build holds. CI has as many cases under way as the machine has processors, so more threads for
//   one build are taken from the build beside it. The bytes are the same on any number of threads
//   (builds-on-one-thread-and-on-several-give-the-same-bytes.test.ts).
// - on Linux, as the program alone (harness/program-alone.ts): the compile is the same, and no copy of Bun is written for each scene.
// AOT_REAL_EXECUTABLES=1 around a run asks for an executable of every build of this file. Without it the program of all scenes is an
// executable too, unless AOT_PROGRAMS_ALONE asks for every program alone.
const atTheBuildOfAllScenes = process.env.AOT_REAL_EXECUTABLES
  ? { ...bunEnv, BUN_AOT_WRITES_PROGRAM_ALONE: undefined }
  : bunEnv;
const atTheBuildOfOneScene =
  isLinux && !process.env.AOT_REAL_EXECUTABLES
    ? { ...bunEnv, BUN_AOT_WRITES_PROGRAM_ALONE: "1" }
    : atTheBuildOfAllScenes;

test.concurrent(
  "the two traps get and answer what they do in plain Bun",
  async () => {
    using dir = tempDir("aot-own-property-traps", { "main.mjs": program });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "main.exe" : "main");
    // What console writes for a scene comes as the scene runs, and the line of each scene at the end.
    const said = {
      stdout:
        scenes.map(([, , , stdout = ""]) => stdout).join("") +
        scenes.map(([name, , says]) => `${name}: ${says}\n`).join(""),
      stderr: scenes.map(([, , , , stderr = ""]) => stderr).join(""),
      exitCode: 0,
    };
    await slot(async () => {
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
          folder,
          atTheBuildOfAllScenes,
        ),
      );
      const plain = told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv));
      const compiled = told(await spawned([executable], folder, bunEnv));
      expect({ plain, compiled }).toEqual({ plain: said, compiled: said });
    });
  },
  240_000,
);

// One scene to a program, so that nothing another scene does to its proxy hides what this one's compiled code does.
test.concurrent.each(scenes)(
  "alone: %s",
  // bun:test hands `done` to a case that declares more parameters than its row has, so the two that not every row has get a default.
  async (name, does, says, stdout: string | undefined = undefined, stderr = "") => {
    const alone = `
function show(value) {
  if (typeof value === "symbol") return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
const log = (...list) => { console.log(list.map(show).join(" ")); };
try {
${does}
} catch (error) {
  console.log(error.constructor.name);
}
`;
    using dir = tempDir("aot-own-property-trap", { "main.mjs": alone });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "main.exe" : "main");
    const { ended, logged } = saidBy(says);
    // Here `log` prints too: the lines of the scene one by one, and behind them the name of the error that ended it. A scene that prints
    // through console itself is held to its lines and to what console wrote, and not to where its lines fall between that.
    const printsItself = stdout !== undefined;
    const said = {
      stdout: (stdout ?? logged.map(line => line + "\n").join("")) + (ended === "returned" ? "" : ended + "\n"),
      stderr,
      exitCode: 0,
    };
    const heard = (run: ReturnType<typeof told>) =>
      printsItself ? { ...run, stdout: withoutLogged(run.stdout, logged) } : run;
    await slot(async () => {
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", withThreads(1), "./main.mjs", "--outfile", executable],
          folder,
          atTheBuildOfOneScene,
        ),
      );
      const plain = told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv));
      const compiled = told(await spawned([executable], folder, bunEnv));
      expect({ plain: heard(plain), compiled: heard(compiled) }).toEqual({ plain: said, compiled: said });
      // Where its lines fall, the compiled program is held to plain Bun.
      expect(compiled).toEqual(plain);
    });
  },
  240_000,
);

const handler = `{
  get(target, key) { return target[key]; },
  set(target, key, value, receiver) {
    if (receiver !== proxy) return Reflect.set({ __proto__: null }, key, value, receiver);
    target[key] = String(value);
    return true;
  },
  getOwnPropertyDescriptor(target, key) { return Reflect.getOwnPropertyDescriptor(target, key); },
  defineProperty(target, key, descriptor) { target[key] = String(descriptor.value); return true; },
}`;
const closed = {
  "a store whose trap hands the receiver to Reflect.set": `proxy.A = "b"; console.log(proxy.A);`,
  "a store where nothing is": `proxy.A ??= "b"; console.log(proxy.A);`,
  "Object.defineProperty": `Object.defineProperty(proxy, "A", { value: "b", configurable: true, enumerable: true, writable: true }); console.log(proxy.A);`,
  "Reflect.defineProperty": `console.log(Reflect.defineProperty(proxy, "A", { value: "b", configurable: true }), proxy.A);`,
  "Object.getOwnPropertyDescriptor": `console.log(Object.getOwnPropertyDescriptor(proxy, "A").value, proxy.A);`,
  "Reflect.getOwnPropertyDescriptor": `console.log(Reflect.getOwnPropertyDescriptor(proxy, "A").value, proxy.A);`,
  "Object.hasOwn": `console.log(Object.hasOwn(proxy, "A"));`,
  "hasOwnProperty": `console.log(Object.prototype.hasOwnProperty.call(proxy, "A"));`,
  "propertyIsEnumerable": `console.log(Object.prototype.propertyIsEnumerable.call(proxy, "A"));`,
  "JSON.stringify": `console.log(JSON.stringify(proxy));`,
  "JSON.stringify with an indent": `console.log(JSON.stringify({ inside: proxy }, null, 2));`,
  "console.log": `console.log(proxy);`,
  "console.log behind a text": `console.log("the proxy:", proxy, { inside: proxy });`,
};

// As windowsEnv() in src/js/builtins/ProcessObjectInternals.ts has it: a read under a name nobody knows finds every method that an object inherits.
const answersInUpperCase = `{
  get(target, key) { if (typeof key !== "string") return target[key]; const upper = key.toUpperCase(); if (upper in target) return target[upper]; return target[key]; },
  ownKeys() { return ["A"]; },
  getOwnPropertyDescriptor(target, key) { return Reflect.getOwnPropertyDescriptor(target, key); },
  defineProperty(target, key, descriptor) { target[key] = String(descriptor.value); return true; },
}`;
type Report = { lines: string[]; exitCode: number };
// One run of `bun check --aot --explain=trim` for the cases that read its lines. On one thread, as the build of one scene: the report
// is the same on any number.
function explainTrim(main: string): () => Promise<Report> {
  let report: Promise<Report> | undefined;
  return () =>
    (report ??= (async () => {
      using dir = tempDir("aot-own-property-report", { "main.js": main });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "check", "--aot", "--threads=1", "--no-pretty", "--explain=trim", "main.js"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { lines: (stdout + stderr).split("\n"), exitCode };
    })());
}
/** The lines of a report that say how much the compiler sees, and how the check ended. A check that failed shows what else it wrote. */
const verdictOf = ({ lines, exitCode }: Report) => ({
  verdict: lines.filter(line => /^aot: trim: (?:the compiler |blocked by )/.test(line)),
  exitCode,
  ...(exitCode !== 0 && { wrote: lines.filter(line => !line.startsWith("aot: trim: ")) }),
});
const seesEveryApi = { verdict: ["aot: trim: the compiler can see every API this program uses"], exitCode: 0 };
/**
 * The lines of a report that came whole. Any other report throws here, which a `failing` goal takes for not met yet: a goal never
 * looks met on a report without its lines, and the case beside it is the one that fails.
 */
async function linesOfWhole(report: () => Promise<Report>) {
  const checked = await report();
  expect(verdictOf(checked)).toEqual(seesEveryApi);
  return checked.lines;
}

for (const [what, text] of Object.entries({
  "a method that the proxy inherits": `console.log(proxy.hasOwnProperty("A"));`,
  "JSON.stringify": `console.log(JSON.stringify(proxy));`,
})) {
  const report = explainTrim(
    `const proxy = new Proxy({ A: "a", toJSON: () => ({}) }, ${answersInUpperCase});\n${text}\n`,
  );
  test.concurrent(`${what}, found by a get that answers in upper case: the compiler sees every API`, async () => {
    expect(verdictOf(await report())).toEqual(seesEveryApi);
  });
  // A goal that is not met yet. Once it is met this case fails: change `test.concurrent.failing` to `test.concurrent`.
  test.concurrent.failing(
    `${what}, found by a get that answers in upper case, gives no trap away (3,698 built-ins escape today, the bound is 20)`,
    async () => {
      // What every object inherits, at the most.
      const escaped = (await linesOfWhole(report)).filter(line =>
        line.endsWith("(escapes, so any member may be used)"),
      );
      sayGoal(`${what}, found by a get that answers in upper case, gives no trap away`, escaped.length, 20);
      expect(escaped.length).toBeLessThanOrEqual(20);
    },
  );
}

for (const [what, text] of Object.entries(closed)) {
  const report = explainTrim(`const proxy = new Proxy({ A: "a" }, ${handler});\n${text}\n`);
  test.concurrent(`${what}: the compiler sees every API`, async () => {
    expect(verdictOf(await report())).toEqual(seesEveryApi);
  });
  // A goal that is not met yet. Once it is met this case fails: change `test.concurrent.failing` to `test.concurrent`.
  test.concurrent.failing(
    `${what} uses no built-in that the program does not name (3,698 escape today, the bound is none)`,
    async () => {
      const escaped = (await linesOfWhole(report)).flatMap(
        line => /trim: uses (.*) \(escapes, so any member may be used\)$/.exec(line)?.[1] ?? [],
      );
      sayGoal(`${what} uses no built-in that the program does not name`, escaped.length, 0);
      expect(escaped).toEqual([]);
    },
  );
}
