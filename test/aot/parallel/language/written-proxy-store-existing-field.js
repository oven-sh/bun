// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
const target = { a: 1 };
const proxy = new Proxy(target, {});
proxy.a = "text";
console.log(typeof target.a, target.a === undefined, target.a + 1, String(target.a));
