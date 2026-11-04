// Beside a direct `eval`, the `typeof` of a name that nothing uses is left out, as without the `eval`: the getter of the global does not run. Only `with` keeps such a `typeof`. The marked call makes the compiler ask what is left of each expression that nothing uses.
const seen = [];
Object.defineProperty(globalThis, "watchedGlobal", {
  get() {
    seen.push("getter");
    return 1;
  },
  configurable: true,
});
function pure() {}
/* @__PURE__ */ pure();
var yes = 1;
function run() {
  eval("0");
  yes && typeof watchedGlobal;
  yes ? typeof watchedGlobal : 0;
}
run();
console.log("reads:", seen.join(" "));
