// The program hangs a class, an instance, a function and an array on the global object and hands a text to one of forty entries that run text: eval and Function
// reached in many ways, node:vm, node:module, a file written at run time. The text replaces a method, changes and deletes fields, calls the function with other
// values and makes a hole. The entry runs the text, and then everything answers as in plain Bun, or the entry is refused, and then the program says so and ends.
const file = `import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "text-")), "t.cjs"); const write = t => fs.writeFileSync(file, t);`;
const vm = `import vm from "node:vm";`;
const moduleOfNode = `import Module from "node:module";`;

export const entries: Record<string, { head?: string; run: string }> = {
  "indirect eval": { run: `(0, eval)(text);` },
  "new Function": { run: `new Function(text)();` },
  "the constructor of an arrow function": { run: `(() => {}).constructor(text)();` },
  "the constructor of an async function": { run: `await Object.getPrototypeOf(async function () {}).constructor(text)();` },
  "the constructor of a generator function": { run: `Object.getPrototypeOf(function* () {}).constructor(text)().next();` },
  "vm.runInThisContext": { head: vm, run: `vm.runInThisContext(text);` },
  "vm.Script": { head: vm, run: `new vm.Script(text).runInThisContext();` },
  "vm.compileFunction": { head: vm, run: `vm.compileFunction(text)();` },
  "vm.runInNewContext with the objects": { head: vm, run: `vm.runInNewContext(text, { K: C, obj, callMe, list, globalThis, Object });` },
  "vm.runInContext of the global object": { head: vm, run: `vm.runInContext(text, vm.createContext(globalThis));` },
  "vm out of process.getBuiltinModule": { run: `process.getBuiltinModule("node:vm").runInThisContext(text);` },
  "vm under a computed name": { run: `require(["node", "vm"].join(":")).runInThisContext(text);` },
  "require of a written file": { head: file, run: `write(text); require(file);` },
  "import of a written file": { head: file, run: `write(text); await import(file);` },
  "import.meta.require of a written file": { head: file, run: `write(text); import.meta.require(file);` },
  "createRequire of a written file": { head: `${file} import { createRequire } from "node:module";`, run: `write(text); createRequire(file)(file);` },
  "Module._load of a written file": { head: `${file} ${moduleOfNode}`, run: `write(text); Module._load(file);` },
  "Module._extensions of a written file": { head: `${file} ${moduleOfNode}`, run: `write(text); Module._extensions[".js"](new Module(file), file);` },
  "Module.prototype._compile": { head: moduleOfNode, run: `new Module("x")._compile(text, "/tmp/x.js");` },
  "import of a data URL": { run: `await import("data:text/javascript," + encodeURIComponent(text));` },
  "Reflect.construct of Function": { run: `Reflect.construct(Function, [text])();` },
  "Reflect.apply of Function": { run: `Reflect.apply(Function, null, [text])();` },
  "Function.call": { run: `Function.call(null, text)();` },
  "Function in a callback": { run: `[text].map(t => Function(t)).forEach(f => f());` },
  "Function bound through call": { run: `const [f] = [text].map(Function.prototype.call.bind(Function, null)); f();` },
  "eval under a computed name": { run: `globalThis[["ev", "al"].join("")](text);` },
  "Function under a computed name": { run: `globalThis[["Func", "tion"].join("")](text)();` },
  "constructor under a computed name": { run: `say[["const", "ructor"].join("")](text)();` },
  "a bound eval": { run: `eval.bind(null)(text);` },
  "eval as a callback": { run: `[text].forEach(eval);` },
  "eval as a reaction": { run: `await Promise.resolve(text).then(eval);` },
  "eval as a member": { run: `({ run: eval }).run(text);` },
  "eval out of its descriptor": { run: `Object.getOwnPropertyDescriptor(globalThis, "eval").value(text);` },
  "Function out of the descriptors of its prototype": { run: `Object.values(Object.getOwnPropertyDescriptors(Function.prototype)).map(d => d.value).find(v => typeof v === "function" && v.name === "Function")(text)();` },
  "a made function as a getter": { run: `Object.defineProperty({}, "x", { get: Function(text) }).x;` },
  "a made function as toString": { run: "`${{ toString: Function(text + '; return String()') }}`;" },
  "a text that the transpiler has read": { run: `(0, eval)(new Bun.Transpiler({ loader: "js" }).transformSync(text));` },
};

export function textOf(entry: string) {
  const { head = "", run } = entries[entry];
  return `${head}
const say = (...a) => console.log("entry | " + a.map(String).join(" "));
class C { constructor() { this.early = 1; this.late = 2; } m() { return 1; } sum() { return this.early + this.late; } }
function callMe(x) { return x + 1; }
const obj = new C();
globalThis.K = C; globalThis.obj = obj; globalThis.callMe = callMe; globalThis.list = [1, 2, 3];
const text = "K.prototype.m = () => 'patched'; obj.early = 'str'; delete obj.late; obj.added = 1; globalThis.r1 = callMe('s'); globalThis.r2 = callMe({}); list[1] = 'x'; list.length = 5; Object.setPrototypeOf(K.prototype, { up() { return 'up'; } });";
try { ${run} } catch (e) { say("REFUSED", e.constructor.name); process.exit(0); }
say(obj.m(), new C().m(), obj.sum(), obj.early, obj.late, obj.added, Object.keys(obj).join());
say(globalThis.r1, globalThis.r2, callMe(1), list.join(), list.length, 3 in list, typeof obj.up);
let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; say(s);
`;
}
