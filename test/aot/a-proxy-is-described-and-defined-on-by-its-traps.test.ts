// Object.getOwnPropertyDescriptor, Object.defineProperty, the same two of Reflect, a test for an own property and the receiver of
// Reflect.set reach two traps of a proxy: getOwnPropertyDescriptor and defineProperty. The compiler follows the proxy through them, so
// what the traps get and what they answer has to be what plain Bun hands them, and a program that does no more than this to a proxy
// uses no more of the built-ins than it names. JSON.stringify asks a proxy by get, ownKeys and getOwnPropertyDescriptor in the same way.
// console.log prints the target of a proxy and asks nothing. Each scene has a proxy and a handler of its own.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
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

test("the two traps get and answer what they do in plain Bun", async () => {
  using dir = tempDir("aot-own-property-traps", { "main.mjs": program });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "main.exe" : "main");
  await slot(async () => {
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], folder, bunEnv),
    );
    const plain = told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv));
    expect(plain.stdout.split("\n").length).toBeGreaterThan(scenes.length);
    expect(told(await spawned([executable], folder, bunEnv))).toEqual(plain);
  });
}, 240_000);

// One scene to a program, so that nothing another scene does to its proxy hides what this one's compiled code does.
test.concurrent.each(scenes)(
  "alone: %s",
  async (name, does) => {
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
    await slot(async () => {
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], folder, bunEnv),
      );
      expect(told(await spawned([executable], folder, bunEnv))).toEqual(
        told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv)),
      );
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
for (const [what, text] of Object.entries({
  "a method that the proxy inherits": `console.log(proxy.hasOwnProperty("A"));`,
  "JSON.stringify": `console.log(JSON.stringify(proxy));`,
}))
  test.concurrent(`${what}, found by a get that answers in upper case, gives no trap away`, async () => {
    using dir = tempDir("aot-own-property-report", {
      "main.js": `const proxy = new Proxy({ A: "a", toJSON: () => ({}) }, ${answersInUpperCase});\n${text}\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = (stdout + stderr).split("\n");
    expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
    // What every object inherits, at the most.
    expect(lines.filter(line => line.endsWith("(escapes, so any member may be used)")).length).toBeLessThanOrEqual(20);
  });

for (const [what, text] of Object.entries(closed))
  test.concurrent(`${what} uses no built-in that the program does not name`, async () => {
    using dir = tempDir("aot-own-property-report", {
      "main.js": `const proxy = new Proxy({ A: "a" }, ${handler});\n${text}\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = (stdout + stderr).split("\n");
    expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
    expect(
      lines.flatMap(line => /trim: uses (.*) \(escapes, so any member may be used\)$/.exec(line)?.[1] ?? []),
    ).toEqual([]);
  });
