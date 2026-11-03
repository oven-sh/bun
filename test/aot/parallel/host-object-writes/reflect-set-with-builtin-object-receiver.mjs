// Reflect.set finds no setter on its target and defines the value on the receiver, which is a built-in object. The member is read and called afterwards.
function replaced() {
  return "replaced";
}
const row = (what, run) => {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw", error.constructor.name);
  }
};
row("process.pid", () => [Reflect.set({}, "pid", 7, process), process.pid]);
row("process.cwd", () => [Reflect.set({}, "cwd", replaced, process), process.cwd === replaced, process.cwd()]);
row("process.added", () => [Reflect.set({}, "added", 7, process), process.added]);
row("console.table", () => [Reflect.set(console, "table", replaced, console), console.table === replaced, console.table()]);
row("Bun.argv", () => [Reflect.set({}, "argv", 7, Bun), Bun.argv]);
row("queueMicrotask", () => [Reflect.set(globalThis, "queueMicrotask", replaced, globalThis), queueMicrotask === replaced, queueMicrotask()]);
row("escape", () => [Reflect.set({}, "escape", replaced, globalThis), escape === replaced, escape("a b")]);
row("navigator.added", () => [Reflect.set({}, "added", 7, navigator), navigator.added]);
const key = ["up", "time"].join("");
row("process.uptime", () => [Reflect.set({}, key, replaced, process), process.uptime === replaced, process.uptime()]);
const proxy = new Proxy(performance, { set: (target, name, value) => Reflect.set(target, name, value, target) });
row("performance.now", () => [(proxy.now = replaced) === replaced, performance.now === replaced, performance.now()]);
