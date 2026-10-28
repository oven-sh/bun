// `require` of Module.prototype is replaced through a value that the compiler cannot follow. The store is taken, as under plain Bun.
// The replacement is asked for a name that is computed. A name that is a constant was resolved by the build and asks nobody, where plain Bun asks:
// there the first line reads `true`. The expected output is written down.
import Module from "node:module";
const holder: any = process.argv.length > 99 ? {} : Module.prototype;
const original = holder.require;
holder.require = function (this: unknown, name: string) {
  return name === "node:os" ? { replaced: true } : original.call(this, name);
};
const made = Module.createRequire(import.meta.url);
console.log("a constant name:", made("node:os").replaced);
const computed = process.argv.length > 99 ? "node:fs" : "node:" + "os".slice(0);
console.log("a computed name:", made(computed).replaced);
console.log("another computed name:", typeof made(process.argv.length > 99 ? "node:os" : "node:" + "path".slice(0)).join);
console.log("what lies there:", holder.require === original, Module.prototype.require === holder.require);
