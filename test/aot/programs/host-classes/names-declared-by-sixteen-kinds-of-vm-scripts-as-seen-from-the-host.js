const vm = require("node:vm");
function tryOne(name, code, key) {
  const sandbox = Object.create(null); sandbox.seed = 2;
  const context = vm.createContext(sandbox);
  const before = new Set(Object.getOwnPropertyNames(context));
  let result; try { result = vm.runInContext(code, context); } catch (e) { result = "threw " + e.name; }
  const names = Object.getOwnPropertyNames(context).filter(n => !before.has(n)).join();
  const d = Object.getOwnPropertyDescriptor(context, key);
  let again; try { again = vm.runInContext("typeof " + key + " === 'undefined' ? 'gone' : typeof " + key, context); } catch (e) { again = "threw " + e.name; }
  console.log(name.padEnd(28), "| new names:", names || "-", "| own value:", d ? ("value" in d ? typeof d.value + " " + String(typeof d.value === "function" ? "fn" : d.value) : "accessor") : "none", "| host read:", typeof context[key], "| in:", key in context, "| a later script sees:", again);
}
tryOne("var with a value", "var made = seed * 21", "made");
tryOne("var, then a store", "var made; made = 42", "made");
tryOne("function declaration", "function made() {}", "made");
tryOne("implicit global", "made = 42", "made");
tryOne("globalThis.made", "globalThis.made = 42", "made");
tryOne("this.made", "this.made = 42", "made");
tryOne("let", "let made = 42", "made");
tryOne("const", "const made = 42", "made");
tryOne("class", "class made {}", "made");
tryOne("var in a second script", "var other = 1", "other");
tryOne("var over a host's name", "var seed = 7", "seed");
tryOne("defineProperty", "Object.defineProperty(globalThis, 'made', { value: 42, enumerable: true, configurable: true, writable: true })", "made");
tryOne("async function", "async function made() {}", "made");
tryOne("var in eval", "eval('var made = 42')", "made");
const s = new vm.Script("var viaScript = 5; function alsoScript() {}"); const c2 = vm.createContext({}); s.runInContext(c2); console.log("new vm.Script:", Object.getOwnPropertyNames(c2).join() || "-");
const r = {}; vm.runInNewContext("var fresh = 1; function f() {}", r); console.log("runInNewContext:", Object.getOwnPropertyNames(r).join() || "-");
