// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
// Flags: --aot-validate
const proxy = new Proxy(Math, {});
proxy.added = 7;
console.log(typeof Math.added, Math.added === undefined, Math.added + 1, String(Math.added));
