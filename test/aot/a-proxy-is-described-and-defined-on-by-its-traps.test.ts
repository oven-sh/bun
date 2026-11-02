// Object.getOwnPropertyDescriptor, Object.defineProperty, the same two of Reflect, a test for an own property and the receiver of
// Reflect.set reach two traps of a proxy: getOwnPropertyDescriptor and defineProperty. The compiler follows the proxy through them, so
// what the traps get and what they answer has to be what plain Bun hands them, and a program that does no more than this to a proxy
// uses no more of the built-ins than it names. JSON.stringify asks a proxy by get, ownKeys and getOwnPropertyDescriptor in the same way.
// console.log prints the target of a proxy and asks nothing. Each scene has a proxy and a handler of its own.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { built, limitWithASAN, slot, spawned, told } from "./harness/commands";
import { withReport } from "./harness/flags";
import { test } from "./supported";

const scenes: [name: string, does: string][] = [
  [
    "the answer holds what the trap's answer holds",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor(t, k) { log("describe", k); return { value: { mark: "made by the trap" }, configurable: true }; } });
     const d = Object.getOwnPropertyDescriptor(proxy, "a");
     log(d.value.mark, d.writable, d.enumerable, d.configurable, Object.keys(d));`,
  ],
  [
    "the answer holds the accessors that the trap answers",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor(t, k) { return { get() { return "got by " + typeof this; }, set(v) { log("set", v); }, configurable: true }; } });
     const d = Reflect.getOwnPropertyDescriptor(proxy, "a");
     log(d.get(), d.set("x"), Object.keys(d));`,
  ],
  [
    "a trap that answers nothing",
    `const proxy = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { log("describe", k); } });
     log(Object.getOwnPropertyDescriptor(proxy, "a"), Object.hasOwn(proxy, "a"));`,
  ],
  [
    "a getter of the trap's answer runs",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return { get value() { log("value is read"); return { mark: "from the getter" }; }, configurable: true }; } });
     log(Object.getOwnPropertyDescriptor(proxy, "a").value.mark);`,
  ],
  [
    "what was described is defined elsewhere under the same key",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return { value: { mark: "described" }, configurable: true, enumerable: true }; } });
     const other = {};
     Object.defineProperty(other, "a", Object.getOwnPropertyDescriptor(proxy, "a"));
     log(other.a.mark, Object.keys(other));`,
  ],
  [
    "a field of the target that only the trap's built-in sees",
    `const target = { hidden: { mark: "on the target" }, other: 2 };
     const proxy = new Proxy(target, { getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); } });
     log(Object.getOwnPropertyDescriptor(proxy, "hidden").value.mark, Object.hasOwn(proxy, "other"), Object.hasOwn(proxy, "none"));`,
  ],
  [
    "the trap gets a descriptor of the engine's own",
    `let kept;
     const proxy = new Proxy({}, { defineProperty(t, k, d) { kept = d; log("define", k, Object.keys(d), "get" in d, d.value.mark, d.writable, d.enumerable, d.configurable); return true; } });
     const given = { value: { mark: "given" }, enumerable: true, extra: 1 };
     log(Object.defineProperty(proxy, "a", given) === proxy, kept === given, Object.getPrototypeOf(kept) === Object.prototype, kept.extra);`,
  ],
  [
    "a trap that writes to its descriptor leaves the program's alone",
    `const proxy = new Proxy({}, { defineProperty(t, k, d) { d.value = { mark: "written by the trap" }; d.more = 1; return true; } });
     const given = { value: { mark: "given" }, configurable: true };
     Reflect.defineProperty(proxy, "a", given);
     log(given.value.mark, Object.keys(given));`,
  ],
  [
    "the value that is defined goes where the trap puts it",
    `const side = {};
     const proxy = new Proxy({}, { get(t, k) { return side[k]; }, defineProperty(t, k, d) { side[k] = d.value; return true; } });
     Object.defineProperty(proxy, "a", { value: { mark: "through the trap" }, configurable: true });
     log(proxy.a.mark, side.a.mark);`,
  ],
  [
    "the accessors that are defined reach the trap",
    `const proxy = new Proxy({}, { defineProperty(t, k, d) { log(Object.keys(d), d.get(), d.set("y")); return true; } });
     Object.defineProperty(proxy, "a", { get() { return "the getter ran"; }, set(v) { log("the setter got", v); }, configurable: true });`,
  ],
  [
    "the proxy that Object.defineProperty answers is the proxy",
    `const proxy = new Proxy({ a: "of the target" }, { get(t, k) { log("get", k); return t[k]; }, defineProperty() { return true; } });
     log(Object.defineProperty(proxy, "b", { value: 1, configurable: true }).a);`,
  ],
  [
    "a trap that refuses",
    `const proxy = new Proxy({}, { defineProperty() { return false; } });
     log(Reflect.defineProperty(proxy, "a", { value: 1 }));
     Object.defineProperty(proxy, "a", { value: 1 });`,
  ],
  [
    "a trap that throws",
    `const proxy = new Proxy({}, { defineProperty() { throw { mark: "thrown by define" }; }, getOwnPropertyDescriptor() { throw { mark: "thrown by describe" }; } });
     try { Object.defineProperty(proxy, "a", { value: 1 }); } catch (e) { log(e.mark); }
     try { Object.getOwnPropertyDescriptor(proxy, "a"); } catch (e) { log(e.mark); }
     try { Object.hasOwn(proxy, "a"); } catch (e) { log(e.mark); }
     try { Reflect.set({}, "a", 1, proxy); } catch (e) { log(e.mark); }`,
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
  ],
  [
    "a setter that Reflect.set finds runs for the proxy",
    `const proxy = new Proxy({ name: "the target" }, { get(t, k) { log("get", k); return t[k]; }, getOwnPropertyDescriptor() { log("describe"); }, defineProperty() { log("define"); return true; } });
     log(Reflect.set({ set a(v) { log("setter", v, this === proxy, this.name); } }, "a", 1, proxy));`,
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
  ],
  [
    "the three tests for an own property",
    `const proxy = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { log("describe", k); return k === "made" ? { value: 1, configurable: true, enumerable: false } : Reflect.getOwnPropertyDescriptor(t, k); } });
     log(Object.hasOwn(proxy, "a"), Object.hasOwn(proxy, "made"), Object.hasOwn(proxy, "none"));
     log(Object.prototype.hasOwnProperty.call(proxy, "a"), Object.prototype.hasOwnProperty.call(proxy, "none"));
     log(Object.prototype.propertyIsEnumerable.call(proxy, "a"), Object.prototype.propertyIsEnumerable.call(proxy, "made"));
     log({}.hasOwnProperty.call(proxy, Symbol.iterator));`,
  ],
  [
    "a handler without the trap hands the question on to the target",
    `const target = { a: { mark: "of the target" } };
     const proxy = new Proxy(target, { get(t, k) { return t[k]; } });
     log(Object.getOwnPropertyDescriptor(proxy, "a").value.mark, Object.hasOwn(proxy, "a"));
     Object.defineProperty(proxy, "b", { value: { mark: "defined through" }, enumerable: true });
     log(target.b.mark, Object.keys(target));
     log(Reflect.set({}, "c", { mark: "set through" }, proxy), target.c.mark);`,
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
  ],
  [
    "traps that are built-ins",
    `const target = {};
     const proxy = new Proxy(target, { getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor, defineProperty: Reflect.defineProperty });
     Object.defineProperty(proxy, "a", { value: { mark: "by Reflect" }, configurable: true });
     log(target.a.mark, Object.getOwnPropertyDescriptor(proxy, "a").value.mark, Reflect.set({}, "b", { mark: "set" }, proxy), target.b.mark);`,
  ],
  [
    "a proxy of a proxy",
    `const inner = new Proxy({}, { getOwnPropertyDescriptor(t, k) { log("inner describes", k); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log("inner defines", k, d.value.mark); return Reflect.defineProperty(t, k, d); } });
     const outer = new Proxy(inner, { getOwnPropertyDescriptor(t, k) { log("outer describes", k); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log("outer defines", k); return Reflect.defineProperty(t, k, d); } });
     Object.defineProperty(outer, "a", { value: { mark: "through both" }, configurable: true });
     log(Object.getOwnPropertyDescriptor(outer, "a").value.mark);`,
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
  ],
  [
    "a key that is converted",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor(t, k) { log("describe", typeof k, k); }, defineProperty(t, k, d) { log("define", typeof k, k); return true; } });
     const key = { toString() { log("the key is converted"); return "made"; } };
     Object.getOwnPropertyDescriptor(proxy, key);
     Object.defineProperty(proxy, key, {});
     Object.hasOwn(proxy, 1);
     Reflect.set({}, Symbol.for("s"), 1, proxy);`,
  ],
  [
    "JSON.stringify lists the proxy and reads what it lists",
    `const proxy = new Proxy({ a: { mark: "of the target" }, b: 2 }, {
       get(t, k) { log("get", k); return k === "made" ? { mark: "made by get" } : t[k]; },
       ownKeys(t) { log("ownKeys"); return [...Reflect.ownKeys(t), "made"]; },
       getOwnPropertyDescriptor(t, k) { log("describe", k); return k === "made" ? { value: 1, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k); },
     });
     log(JSON.stringify(proxy), JSON.stringify({ inside: proxy }, null, 1).length);`,
  ],
  [
    "JSON.stringify calls the toJSON that get answers, on the proxy",
    `const proxy = new Proxy({ a: 1 }, { get(t, k) { log("get", k); return k === "toJSON" ? function (key) { log("toJSON", key, this === proxy); return { mark: "from toJSON" }; } : t[k]; } });
     log(JSON.stringify(proxy), JSON.stringify([proxy]));`,
  ],
  [
    "JSON.stringify goes on to what the traps answer",
    `const inner = { toJSON() { log("the inner toJSON runs"); return "inner"; } };
     const proxy = new Proxy({}, { get(t, k) { return k === "x" ? inner : undefined; }, ownKeys() { return ["x"]; }, getOwnPropertyDescriptor() { return { value: 0, enumerable: true, configurable: true }; } });
     log(JSON.stringify(proxy));`,
  ],
  [
    "JSON.stringify of a proxy of a list",
    `const proxy = new Proxy([{ mark: "first" }, 2], { get(t, k) { log("get", k); return t[k]; } });
     log(JSON.stringify(proxy));`,
  ],
  [
    "JSON.stringify without a trap lists the target",
    `const target = { seen: { mark: "only by JSON" }, get computed() { log("the getter runs for", this === proxy); return 1; } };
     const proxy = new Proxy(target, {});
     log(JSON.stringify(proxy));`,
  ],
  [
    "JSON.stringify with a function or a list beside the proxy",
    `const proxy = new Proxy({ a: 1, b: 2 }, { get(t, k) { log("get", k); return t[k]; }, ownKeys(t) { log("ownKeys"); return Reflect.ownKeys(t); } });
     log(JSON.stringify(proxy, (key, value) => { log("replacer", key, value === proxy); return value; }));
     log(JSON.stringify(proxy, ["b"]));`,
  ],
  [
    "a trap that throws while JSON.stringify lists",
    `const proxy = new Proxy({ a: 1 }, { ownKeys() { throw { mark: "thrown by ownKeys" }; } });
     try { JSON.stringify(proxy); } catch (e) { log(e.mark); }`,
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
  ],
  [
    "console.log calls what the target has for the formatter",
    `const target = { a: 1 };
     target[Symbol.for("nodejs.util.inspect.custom")] = function () { log("the target's own printer runs for the target", this === target); return { printed: { mark: "by the target" } }; };
     const proxy = new Proxy(target, { get(t, k) { log("get", k); return t[k]; } });
     console.log(proxy);
     console.log(new Proxy(proxy, {}));`,
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
  ],
  [
    "a text of the command line in front of a proxy",
    `const proxy = new Proxy({ a: 1 }, { get(t, k) { log("get", k); return k === "toString" ? () => "converted" : k === Symbol.toPrimitive ? undefined : t[k]; } });
     console.log(process.argv[2] ?? "%s", proxy);`,
  ],
  [
    "console.dir and console.table of a proxy",
    `const proxy = new Proxy({ a: 1, b: { c: 2 } }, { get(t, k) { log("get", k); return t[k]; }, ownKeys(t) { log("ownKeys"); return Reflect.ownKeys(t); } });
     console.dir(proxy);
     console.dir({ a: { b: { c: {} } } }, new Proxy({ depth: 0 }, { get(t, k) { log("the options are asked for", k); return t[k]; } }));
     console.table(proxy);`,
  ],
  [
    "the methods of Object.prototype that only look at their receiver",
    `const proxy = new Proxy({ a: 1 }, { get(t, k) { log("get", k); return k === Symbol.toStringTag ? "Tagged" : Reflect.get(t, k); }, getPrototypeOf(t) { log("getPrototypeOf"); return Reflect.getPrototypeOf(t); } });
     log(Object.prototype.valueOf.call(proxy) === proxy, Object.prototype.valueOf.call(proxy).a);
     log(Object.prototype.toString.call(proxy));
     log(Object.prototype.isPrototypeOf.call(proxy, {}), Object.prototype.isPrototypeOf.call(proxy, Object.create(proxy)));
     log(Object.prototype.toLocaleString.call(proxy));
     log(proxy.valueOf() === proxy, proxy.toString(), typeof Object.call(proxy, "x"));`,
  ],
  [
    "__defineGetter__ and __defineSetter__ reach the trap that defines",
    `const proxy = new Proxy({}, { defineProperty(t, k, d) { log("define", k, Object.keys(d), d.get && d.get(), d.set && d.set("given")); return Reflect.defineProperty(t, k, d); } });
     Object.prototype.__defineGetter__.call(proxy, "a", () => "the getter ran");
     Object.prototype.__defineSetter__.call(proxy, "b", value => { log("the setter got", value); });
     log(proxy.a);
     Object.prototype.__defineGetter__.call(proxy, "c");`,
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
  ],
  [
    "the methods of Function.prototype refuse a proxy of what is no function",
    `const proxy = new Proxy({}, { get(t, k) { log("get", k); return t[k]; }, getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); }, getPrototypeOf(t) { log("getPrototypeOf"); return Reflect.getPrototypeOf(t); } });
     for (const method of [Function.prototype.bind, Function.prototype.call, Function.prototype.apply, Function.prototype.toString]) {
       try { method.call(proxy); } catch (e) { log(e.constructor.name); }
     }
     log(Function.prototype[Symbol.hasInstance].call(proxy, {}));`,
  ],
  [
    "a proxy of a function is bound, called and printed",
    `const proxy = new Proxy(function named(a, b) { return "called with " + a; }, { get(t, k) { log("get", k); return t[k]; }, getOwnPropertyDescriptor(t, k) { log("describe", k); return Reflect.getOwnPropertyDescriptor(t, k); }, apply(t, s, l) { log("apply", l); return Reflect.apply(t, s, l); } });
     const bound = Function.prototype.bind.call(proxy, null, "the bound operand");
     log(bound(), bound.name, bound.length, Function.prototype.call.call(proxy, null, "x"), typeof Function.prototype.toString.call(proxy));`,
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
  ],
  [
    "a trap's answer that is no object",
    `const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return 1; } });
     try { Object.getOwnPropertyDescriptor(proxy, "a"); } catch (e) { log(e.constructor.name); }`,
  ],
];

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

test.concurrent(
  "the two traps get and answer what they do in plain Bun",
  async () => {
    using dir = tempDir("aot-own-property-traps", { "main.mjs": program });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "main.exe" : "main");
    await slot(async () => {
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], folder, bunEnv),
      );
      const plain = told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv));
      // The line of each scene. In front of them stands what console.log makes of a proxy.
      expect(
        normalizeBunSnapshot(
          plain.stdout
            .split("\n")
            .slice(-scenes.length - 1)
            .join("\n"),
        ),
      ).toMatchInlineSnapshot(`
        "the answer holds what the trap's answer holds: returned: describe a | made by the trap false false true [value,writable,enumerable,configurable]
        the answer holds the accessors that the trap answers: returned: set x | got by object undefined [get,set,enumerable,configurable]
        a trap that answers nothing: returned: describe a | describe a | undefined false
        a getter of the trap's answer runs: returned: value is read | from the getter
        what was described is defined elsewhere under the same key: returned: described [a]
        a field of the target that only the trap's built-in sees: returned: on the target true false
        the trap gets a descriptor of the engine's own: returned: define a [value,enumerable] false given undefined true undefined | true false true undefined
        a trap that writes to its descriptor leaves the program's alone: returned: given [value,configurable]
        the value that is defined goes where the trap puts it: returned: through the trap through the trap
        the accessors that are defined reach the trap: returned: the setter got y | [get,set,configurable] the getter ran undefined
        the proxy that Object.defineProperty answers is the proxy: returned: get a | of the target
        a trap that refuses: TypeError: false
        a trap that throws: returned: thrown by define | thrown by describe | thrown by describe | thrown by describe
        Reflect.set asks its receiver what is there and defines the value: returned: describe a | define a [value,writable,enumerable,configurable] first | true | describe a | define a [value] second | true | describe a | second
        a setter that Reflect.set finds runs for the proxy: returned: get name | setter 1 true the target | true
        a store on the proxy and on its heir: returned: STORED undefined STORED of the heir [b] [a] | the other defines c for another proxy | true
        a store under a key of the command line: returned: 1 [a]
        the three tests for an own property: returned: describe a | describe made | describe none | true true false | describe a | describe none | true false | describe a | describe made | true false | describe Symbol(Symbol.iterator) | false
        a handler without the trap hands the question on to the target: returned: of the target true | defined through [a,b] | true set through
        a trap that is put there later: returned: 1 | from the later trap | the later trap defines 2
        traps that are built-ins: returned: by Reflect by Reflect true set
        a proxy of a proxy: returned: outer defines a | inner defines a through both | inner describes a | outer describes a | inner describes a | inner describes a | through both
        what the engine holds against the target: returned: TypeError | TypeError | TypeError | undefined | TypeError | TypeError
        a key that is converted: returned: the key is converted | describe string made | the key is converted | define string made | describe string 1 | describe symbol Symbol(s) | define symbol Symbol(s)
        JSON.stringify lists the proxy and reads what it lists: returned: get toJSON | ownKeys | describe a | describe b | describe made | get a | get b | get made | get toJSON | ownKeys | describe a | describe b | describe made | get a | get b | get made | {"a":{"mark":"of the target"},"b":2,"made":{"mark":"made by get"}} 111
        JSON.stringify calls the toJSON that get answers, on the proxy: returned: get toJSON | toJSON  true | get toJSON | toJSON 0 true | {"mark":"from toJSON"} [{"mark":"from toJSON"}]
        JSON.stringify goes on to what the traps answer: returned: the inner toJSON runs | {"x":"inner"}
        JSON.stringify of a proxy of a list: returned: get toJSON | get length | get 0 | get 1 | [{"mark":"first"},2]
        JSON.stringify without a trap lists the target: returned: the getter runs for true | {"seen":{"mark":"only by JSON"},"computed":1}
        JSON.stringify with a function or a list beside the proxy: returned: get toJSON | replacer  true | ownKeys | get a | replacer a false | get b | replacer b false | {"a":1,"b":2} | get toJSON | get b | {"b":2}
        a trap that throws while JSON.stringify lists: returned: thrown by ownKeys
        console.log prints the target and asks no trap: returned: []
        console.log calls what the target has for the formatter: returned: the target's own printer runs for the target true | the target's own printer runs for the target true
        a text with a % converts the proxy behind it: returned: get Symbol(Symbol.toPrimitive) | get toString | get toJSON | ownKeys | describe a | get a | get Symbol(Symbol.toPrimitive) | get valueOf | get toString
        a text of the command line in front of a proxy: returned: get Symbol(Symbol.toPrimitive) | get toString
        console.dir and console.table of a proxy: returned: the options are asked for depth | the options are asked for colors | get Symbol(Symbol.iterator) | ownKeys | get a | get b
        the methods of Object.prototype that only look at their receiver: returned: get a | true 1 | get Symbol(Symbol.toStringTag) | [object Tagged] | false true | get toString | get Symbol(Symbol.toStringTag) | [object Tagged] | get valueOf | get toString | get Symbol(Symbol.toStringTag) | true [object Tagged] object
        __defineGetter__ and __defineSetter__ reach the trap that defines: TypeError: define a [get,enumerable,configurable] the getter ran undefined | the setter got given | define b [set,enumerable,configurable] undefined undefined | the getter ran
        __lookupGetter__ and __lookupSetter__ ask the trap that describes and go on above: returned: describe made | describe own | describe inherited | made by the trap of the target from above | describe inherited | describe none | function undefined | getPrototypeOf | from above
        the methods of Function.prototype refuse a proxy of what is no function: returned: TypeError | TypeError | TypeError | TypeError | false
        a proxy of a function is bound, called and printed: returned: describe length | get length | get name | apply [the bound operand] | apply [x] | called with the bound operand bound named 1 called with x string
        a get that answers under the name in upper case: returned: describe A | describe a | b true false {"A":"b","by":"toJSON"} [object Object] true
        a trap's answer that is no object: returned: TypeError"
      `);
      expect(plain.exitCode).toBe(0);
      expect(told(await spawned([executable], folder, bunEnv))).toEqual(plain);
    });
  },
  240_000,
);

// One scene to a program, so that nothing another scene does to its proxy hides what this one's compiled code does. A build is
// what costs, so a build holds several of them: --aot-separate-programs compiles each entry point as it is compiled when it is
// built alone, and BUN_AOT_START_AT says at which of them a run starts.
const alone = scenes.map(([name, does], index) => ({
  name,
  file: `scene-${String(index).padStart(2, "0")}.mjs`,
  text: `
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
`,
}));
const aloneDir = tempDir("aot-own-property-trap", Object.fromEntries(alone.map(({ file, text }) => [file, text])));
afterAll(() => aloneDir[Symbol.dispose]());
const aloneFolder = String(aloneDir);
const executableNamed = (name: string) => join(aloneFolder, isWindows ? `${name}.exe` : name);

// A build compiles its programs one after another, so it holds five scenes at the most, and the builds run beside one another.
const buildCount = Math.ceil(alone.length / 5);
type Run = Awaited<ReturnType<typeof spawned>>;
const runs: Promise<Map<string, Run>>[] = [];
let startsWhereTold: Promise<boolean> | undefined;
/**
 * How each scene of build `number` ran as a program of that build's executable. The build starts with the first test that asks
 * for it. Its executable is as large as Bun, and is gone when its scenes have run.
 */
const runsOfBuild = (number: number) =>
  (runs[number] ??= slot(async () => {
    const files = alone.filter((_, index) => index % buildCount === number).map(({ file }) => file);
    const executable = executableNamed(`build-${number}`);
    const report = join(aloneFolder, `build-${number}.json`);
    const flags = ["--aot-separate-programs", "--root=.", ...withReport(report, "summary")];
    const entryPoints = files.map(file => `./${file}`);
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", ...flags, ...entryPoints, "--outfile", executable],
        aloneFolder,
        bunEnv,
        // Five programs may take longer than the one that the limit is made for.
        2 * limitWithASAN,
      ),
    );
    // Scenes that a build had joined into one program would still print what they print in plain Bun.
    expect(readBuildReport(report).statistics.WholeEngineRuns).toBe(files.length);
    // Only a canary build reads BUN_AOT_START_AT, and it refuses a name that no entry point has.
    startsWhereTold ??= spawned([executable], aloneFolder, { ...bunEnv, BUN_AOT_START_AT: "no-scene.mjs" }).then(
      refused => refused.stderr.includes("BUN_AOT_START_AT"),
    );
    const ran = new Map<string, Run>();
    for (const file of files) {
      if (await startsWhereTold) {
        ran.set(file, await spawned([executable], aloneFolder, { ...bunEnv, BUN_AOT_START_AT: file }));
        continue;
      }
      // Any other Bun starts an executable at its first entry point, so there each scene gets an executable of its own.
      const own = executableNamed(file.replace(".mjs", ""));
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", `./${file}`, "--outfile", own], aloneFolder, bunEnv),
      );
      ran.set(file, await spawned([own], aloneFolder, bunEnv));
      rmSync(own, { force: true });
    }
    rmSync(executable, { force: true });
    return ran;
  }));

test.concurrent.each(alone.map(({ name }, index): [string, number] => [name, index]))(
  "alone: %s",
  async (_name, index) => {
    const { file } = alone[index];
    const compiled = (await runsOfBuild(index % buildCount)).get(file)!;
    const plain = await slot(() => spawned([bunExe(), `./${file}`], aloneFolder, bunEnv));
    // Two runs that fail alike, or print nothing, would agree and show nothing.
    expect({
      stderr: plain.exitCode === 0 ? "" : plain.stderr,
      exitCode: plain.exitCode,
      signal: plain.signal,
    }).toEqual({
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    expect(plain.stdout).not.toBe("");
    expect(told(compiled)).toEqual(told(plain));
  },
  600_000,
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
/** What `bun check --aot --explain=trim` says of a program, line by line, and how it ends. */
async function explained(source: string) {
  using dir = tempDir("aot-own-property-report", { "main.js": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { lines: (stdout + stderr).split("\n"), exitCode, signal: proc.signalCode };
}

for (const [what, text] of Object.entries({
  "a method that the proxy inherits": `console.log(proxy.hasOwnProperty("A"));`,
  "JSON.stringify": `console.log(JSON.stringify(proxy));`,
}))
  test.concurrent(`${what}, found by a get that answers in upper case, gives no trap away`, async () => {
    const { lines, ...end } = await explained(
      `const proxy = new Proxy({ A: "a", toJSON: () => ({}) }, ${answersInUpperCase});\n${text}\n`,
    );
    expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
    expect(lines).toContain("aot: trim: uses global Proxy");
    // What every object inherits, at the most.
    expect(lines.filter(line => line.endsWith("(escapes, so any member may be used)")).length).toBeLessThanOrEqual(20);
    expect(end).toEqual({ exitCode: 0, signal: null });
  });

for (const [what, text] of Object.entries(closed))
  test.concurrent(`${what} uses no built-in that the program does not name`, async () => {
    const { lines, ...end } = await explained(`const proxy = new Proxy({ A: "a" }, ${handler});\n${text}\n`);
    expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
    expect(lines).toContain("aot: trim: uses global Proxy");
    expect(
      lines.flatMap(line => /trim: uses (.*) \(escapes, so any member may be used\)$/.exec(line)?.[1] ?? []),
    ).toEqual([]);
    expect(end).toEqual({ exitCode: 0, signal: null });
  });
