// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
// Flags: --aot-validate
const target = [1, 2];
const proxy = new Proxy(target, {});
proxy[0] = "text";
console.log(typeof target[0], target[0] === undefined, target[0] + 1, String(target[0]));
