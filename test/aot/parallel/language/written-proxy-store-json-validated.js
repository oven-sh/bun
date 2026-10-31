// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
// Flags: --aot-validate
const proxy = new Proxy(JSON, {});
proxy.added = 7;
console.log(typeof JSON.added, JSON.added === undefined, JSON.added + 1, String(JSON.added));
