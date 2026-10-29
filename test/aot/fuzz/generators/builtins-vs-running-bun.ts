// Programs about the language's built-ins that are written from what the running Bun has: the generator asks it for the names, so a new
// method of a new version of JavaScriptCore is covered the day it appears. Each program prints one line for each thing it tries:
// `<what>: <what came of it>`.
const world = globalThis as unknown as Record<string, any>;

/** Every static function and every prototype method of the language's globals, held by a constant and called without its holder, with five lists of arguments. */
export function heldAndCalledWithoutTheirHolder(): string {
  const globals = ["Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "Date", "RegExp", "Promise", "Reflect", "JSON", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "ArrayBuffer", "DataView", "Uint8Array", "Int32Array", "Float64Array", "BigInt64Array", "Atomics", "Error", "TypeError", "AggregateError", "Proxy", "Iterator"];
  const skip = new Set(["Date.now", "Math.random", "Function.prototype.toString", "Date.prototype.toLocaleString", "Date.prototype.toLocaleDateString", "Date.prototype.toLocaleTimeString", "Error.captureStackTrace", "Atomics.wait", "Atomics.waitAsync", "Atomics.pause", "Symbol.for", "Date.prototype.getTimezoneOffset"]);
  const out = [`const show = v => { try { return v === null ? "null" : typeof v === "object" ? Object.prototype.toString.call(v) + (Array.isArray(v) ? JSON.stringify(v.map(x => typeof x === "object" || typeof x === "function" || typeof x === "symbol" || typeof x === "bigint" ? typeof x : x)) : "") : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v + ":" + String(v).slice(0, 60); } catch (e) { return "unshowable"; } };`,
    `const lines = []; const row = (name, f) => { let s; try { s = show(f()); } catch (e) { s = "THROWS " + (e && e.constructor && e.constructor.name); } lines.push(name + ": " + s); };`];
  let n = 0;
  const argumentLists = ["", "1", `"ab"`, "[3, 1, 2]", "{ a: 1 }, \"a\""];
  for (const g of globals) {
    const G = world[g];
    if (G === undefined) continue;
    for (const [holder, text] of [[G, g], [G.prototype, g + ".prototype"]] as [any, string][]) {
      if (holder === undefined || holder === null) continue;
      const parent = Object.getPrototypeOf(holder);
      const names = new Set(Object.getOwnPropertyNames(holder));
      if (parent && parent !== Function.prototype && parent !== Object.prototype) for (const k of Object.getOwnPropertyNames(parent)) names.add(k);
      for (const key of [...names].sort()) {
        if (!/^[A-Za-z_$][\w$]*$/.test(key) || key === "constructor" || key === "caller" || key === "arguments" || key === "callee") continue;
        const d = (Object.getOwnPropertyDescriptor(holder, key) ?? Object.getOwnPropertyDescriptor(parent, key))!;
        if (typeof d.value !== "function" || skip.has(text + "." + key)) continue;
        if (/^[A-Z]/.test(key) && holder === G) continue;
        const name = "h" + n++;
        out.push(`const ${name} = ${text}.${key};`);
        argumentLists.forEach((a, i) => out.push(`row("${text}.${key} / ${i}", () => ${name}(${a}));`));
      }
    }
  }
  out.push(`Promise.resolve().then(() => console.log(lines.join("\\n")));`);
  out.push(`process.on("unhandledRejection", () => {});`);
  return out.join("\n");
}

/** Every prototype method of the language's classes called by `.call` on receivers of thirteen kinds, with two lists of arguments. */
export function calledOnReceiversOfManyKinds(): string {
  const globals = ["Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Date", "RegExp", "Promise", "Map", "Set", "WeakMap", "WeakSet", "ArrayBuffer", "DataView", "Uint8Array", "Float64Array", "Error", "Iterator"];
  const skip = new Set(["Function.prototype.toString", "Date.prototype.toLocaleString", "Date.prototype.toLocaleDateString", "Date.prototype.toLocaleTimeString", "Date.prototype.getTimezoneOffset", "Date.prototype.toString", "Date.prototype.toTimeString", "Date.prototype.toDateString", "Object.prototype.toLocaleString", "Array.prototype.toLocaleString", "Number.prototype.toLocaleString", "BigInt.prototype.toLocaleString", "String.prototype.localeCompare", "String.prototype.repeat", "String.prototype.padStart", "String.prototype.padEnd", "Array.prototype.fill", "Array.prototype.copyWithin", "Error.prototype.toString"]);
  const out = [`const show = v => { try { return v === null ? "null" : typeof v === "object" ? Object.prototype.toString.call(v) + (Array.isArray(v) ? JSON.stringify(v.slice(0, 6).map(x => typeof x === "object" || typeof x === "function" || typeof x === "symbol" || typeof x === "bigint" ? typeof x : x)) : "") : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v + ":" + String(v).slice(0, 60); } catch (e) { return "unshowable"; } };`,
    `const lines = []; const row = (name, f) => { let s; try { s = show(f()); } catch (e) { s = "THROWS " + (e && e.constructor && e.constructor.name); } lines.push(name + ": " + s); };`,
    `const receivers = () => [undefined, null, 5, "text", true, { length: 2, 0: "a", 1: "b" }, [3, 1, 2], new Map([[1, 2]]), new Uint8Array([7, 8]), function named(a) {}, new Date(0), /a/g, new Set([1])];`];
  const count = 13;
  for (const g of globals) {
    const P = world[g] && world[g].prototype;
    if (!P) continue;
    const parent = Object.getPrototypeOf(P);
    const names = new Set(Object.getOwnPropertyNames(P));
    if (parent && parent !== Object.prototype) for (const k of Object.getOwnPropertyNames(parent)) names.add(k);
    for (const key of [...names].sort()) {
      if (!/^[A-Za-z_$][\w$]*$/.test(key) || key === "constructor" || key === "caller" || key === "arguments" || key.startsWith("__")) continue;
      const d = (Object.getOwnPropertyDescriptor(P, key) ?? Object.getOwnPropertyDescriptor(parent, key))!;
      if (typeof d.value !== "function" || skip.has(g + ".prototype." + key)) continue;
      out.push(`for (let i = 0; i < ${count}; i++) { row("${g}.prototype.${key} on " + i, () => ${g}.prototype.${key}.call(receivers()[i])); row("${g}.prototype.${key} on " + i + " with 1", () => ${g}.prototype.${key}.call(receivers()[i], 1)); }`);
    }
  }
  out.push(`process.on("unhandledRejection", () => {});`);
  out.push(`Promise.resolve().then(() => console.log(lines.join("\\n")));`);
  return out.join("\n");
}

/** Every global function and constructor of the language held by a constant, then called, constructed, constructed for another class, called by `.call` and extended, with six lists of arguments. */
export function calledConstructedAndExtended(): string {
  const names = Object.getOwnPropertyNames(globalThis).filter(k => /^[A-Za-z]\w*$/.test(k) && typeof world[k] === "function").sort();
  const language = new Set(["Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Date", "RegExp", "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError", "SuppressedError", "DisposableStack", "AsyncDisposableStack", "Proxy", "Iterator", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape"]);
  const out = [`const show = v => { try { return v === null ? "null" : typeof v === "object" ? Object.prototype.toString.call(v) + " " + (Object.getPrototypeOf(v) && Object.getPrototypeOf(v).constructor && Object.getPrototypeOf(v).constructor.name) + (Array.isArray(v) ? JSON.stringify(v.slice(0, 6)) : v instanceof Error ? " " + v.message : ArrayBuffer.isView(v) ? " " + v.byteLength : v instanceof Date ? " " + (isNaN(v) ? "invalid" : v.getTime() < 1e12 ? v.getTime() : "now") : "") : typeof v === "function" ? "function " + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : typeof v + ":" + (typeof v === "string" && /GMT/.test(v) ? "a date" : String(v).slice(0, 60)); } catch (e) { return "unshowable"; } };`,
    `const lines = []; const row = (name, f) => { let s; try { s = show(f()); } catch (e) { s = "THROWS " + (e && e.constructor && e.constructor.name); } lines.push(name + ": " + s); };`,
    `class Other {}`];
  const argumentLists = ["", "3", `"12"`, "[3, 1, 2]", "{ a: 1 }, { get() { return 1; } }", "() => {}"];
  let n = 0;
  for (const g of names) {
    if (!language.has(g)) continue;
    const h = "h" + n++;
    out.push(`const ${h} = ${g};`);
    argumentLists.forEach((a, i) => {
      out.push(`row("${g}(..) / ${i}", () => ${h}(${a}));`);
      out.push(`row("new ${g}(..) / ${i}", () => new ${h}(${a}));`);
      out.push(`row("Reflect.construct(${g}, .., Other) / ${i}", () => Reflect.construct(${h}, [${a}], Other));`);
      out.push(`row("${g}.call(null, ..) / ${i}", () => ${h}.call(null${a ? ", " + a : ""}));`);
      out.push(`row("class extends ${g} / ${i}", () => new (class Sub extends ${h} {})(${a}));`);
    });
  }
  out.push(`process.on("unhandledRejection", () => {});`);
  out.push(`Promise.resolve().then(() => console.log(lines.join("\\n")));`);
  return out.join("\n");
}

/** Every accessor of the language's prototypes read by name off receivers of 38 kinds, among them objects that only inherit from the prototype. */
export function accessorsReadOffReceiversOfManyKinds(): string {
  const globals = ["Object", "Function", "Array", "String", "Symbol", "RegExp", "Map", "Set", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Uint8Array", "Float64Array", "Error", "Iterator", "Promise", "Date", "Number", "WeakRef"];
  const keys = new Set(["length", "name", "message", "stack", "constructor", "prototype", "lastIndex", "cause", "errors"]);
  for (const g of globals) { let P = world[g] && world[g].prototype; for (let depth = 0; P && P !== Object.prototype && depth < 2; depth++, P = Object.getPrototypeOf(P)) for (const k of Object.getOwnPropertyNames(P)) { const d = Object.getOwnPropertyDescriptor(P, k)!; if (d.get && /^[A-Za-z_$][\w$]*$/.test(k) && !k.startsWith("__")) keys.add(k); } }
  const out = [`const show = v => { try { return v === null ? "null" : typeof v === "object" ? Object.prototype.toString.call(v) : typeof v === "function" ? "function " + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : typeof v + ":" + String(v).split("\\n")[0].slice(0, 50); } catch (e) { return "unshowable"; } };`,
    `const lines = []; const row = (name, f) => { let s; try { s = show(f()); } catch (e) { s = "THROWS " + (e && e.constructor && e.constructor.name); } lines.push(name + ": " + s); };`,
    `const makers = [() => undefined, () => null, () => 5, () => "text", () => true, () => Symbol("d"), () => 7n, () => ({ length: 2, size: 9, byteLength: 4, source: "own" }), () => [3, 1, 2], () => new Map([[1, 2]]), () => new Set([1]), () => new Uint8Array([7, 8]), () => new Float64Array(3).subarray(1), () => new ArrayBuffer(6), () => new DataView(new ArrayBuffer(8), 2), () => function named(a, b) {}, () => /a(b)/gi, () => new Error("m", { cause: 1 }), () => Object.create(Map.prototype), () => Object.create(Set.prototype), () => Object.create(Uint8Array.prototype), () => Object.create(RegExp.prototype), () => Object.create(ArrayBuffer.prototype), () => Object.create(DataView.prototype), () => Object.create(Symbol.prototype), () => Object.create(Array.prototype), () => Object.create(String.prototype), () => Object.create(Function.prototype), () => Map.prototype, () => RegExp.prototype, () => Uint8Array.prototype, () => Symbol.prototype, () => new (class M extends Map { get size() { return "mine"; } })(), () => new (class A extends Array {})(4), () => new Proxy(new Map(), {}), () => new Proxy([1, 2], {}), () => Object(Symbol("boxed")), () => new String("boxed")];`];
  for (const k of [...keys].sort()) out.push(`for (let i = 0; i < makers.length; i++) row("${k} of " + i, () => makers[i]().${k});`);
  for (const k of [...keys].sort()) out.push(`for (let round = 0; round < 3; round++) for (let i = makers.length - 1; i >= 0; i--) row("${k} of " + i + " again " + round, () => { const o = makers[i](); return o.${k}; });`);
  out.push(`console.log(lines.join("\\n"));`);
  return out.join("\n");
}
