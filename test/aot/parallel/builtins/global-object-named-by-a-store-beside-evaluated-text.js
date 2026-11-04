// A store names `globalThis` through a receiver that the compiler does not know, in a program that also evaluates text made at run time.
function change(target) {
  target.globalThis = target;
}
const target = globalThis[process.argv[6] ?? "missing"] ?? {};
change(target);
const answer = new Function("return " + (process.argv[5] ?? "1"))();
console.log(String(answer), target.globalThis === target, globalThis.globalThis === globalThis);
