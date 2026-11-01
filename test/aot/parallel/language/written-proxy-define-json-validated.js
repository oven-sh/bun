// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
// Flags: --aot-validate
const proxy = new Proxy(JSON, {});
Object.defineProperty(proxy, "added", { value: 7, configurable: true });
console.log(typeof JSON.added, JSON.added === undefined, JSON.added + 1, String(JSON.added));
