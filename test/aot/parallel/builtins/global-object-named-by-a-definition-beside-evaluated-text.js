// A definition names `globalThis` on a receiver that the compiler does not know, in a program that also evaluates text made at run time.
function change(target, name) {
  Object.defineProperty(target, name, { value: target, configurable: true });
}
const target = globalThis[process.argv[6] ?? "missing"] ?? {};
change(target, "globalThis");
const answer = (0, eval)(process.argv[5] ?? "1");
console.log(String(answer), target.globalThis === target, globalThis.globalThis === globalThis);
