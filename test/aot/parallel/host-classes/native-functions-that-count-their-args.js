// Native functions of the host that count their arguments: called with none they throw, and `undefined` counts as one. Bare, through a variable, through globalThis, by call, apply, a spread of nothing and Reflect.apply.
function attempt(run) { try { const v = run(); return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name + ": " + e.message; } }
const clone = structuredClone, none = [];
console.log("bare", attempt(() => structuredClone()));
console.log("variable", attempt(() => clone()));
console.log("globalThis", attempt(() => globalThis.structuredClone()));
console.log("call", attempt(() => structuredClone.call(undefined)));
console.log("apply", attempt(() => structuredClone.apply(undefined, [])));
console.log("spread", attempt(() => structuredClone(...none)));
console.log("Reflect.apply", attempt(() => Reflect.apply(structuredClone, undefined, none)));
console.log("bound", attempt(structuredClone.bind(undefined)));
console.log("undefined", attempt(() => structuredClone(undefined)), attempt(() => clone(undefined)), attempt(() => structuredClone(undefined, undefined)), attempt(() => structuredClone(void 0, null)));
console.log("values", attempt(() => structuredClone(1)), attempt(() => structuredClone("a")), attempt(() => structuredClone(null)), attempt(() => structuredClone({ a: [1, { b: 2 }] })), attempt(() => structuredClone(5n)), attempt(() => structuredClone(true, {})));
console.log("refused", attempt(() => structuredClone(() => {})).split(":")[0], attempt(() => structuredClone(Symbol("s"))).split(":")[0], attempt(() => structuredClone(1, 5)).split(":")[0]);
function many(n) { let thrown = 0; for (let i = 0; i < n; i++) { try { i & 1 ? structuredClone() : structuredClone(i); } catch { thrown++; } } return thrown; }
console.log("in a loop", many(400));
for (const name of ["atob", "btoa", "queueMicrotask", "setTimeout", "setInterval", "setImmediate", "clearTimeout", "reportError", "fetch", "postMessage"]) {
  if (name === "fetch") { console.log(name, typeof attempt(() => { const p = fetch(); p.catch(() => {}); return "a promise"; })); continue; }
  console.log(name, attempt(() => { const v = globalThis[name](); return typeof v; }).split("\n")[0]);
}
console.log("bare again", attempt(() => atob()), attempt(() => btoa()), attempt(() => queueMicrotask()).split("\n")[0]);
