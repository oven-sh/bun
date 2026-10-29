// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
// Flags: --aot-validate
class C { constructor() { this.a = 1; } }
const target = new C();
const proxy = new Proxy(target, {});
proxy.added = 7;
console.log(typeof target.added, target.added === undefined, target.added + 1, String(target.added));
