// Code from a text takes Bun.$ in an executable that has no code for it. Function.prototype is not above the real function.
const text = process.argv.length > 99 ? "0" : 'const it = Object.getOwnPropertyDescriptor(Bun, "$").value; return [typeof it, it instanceof Function, it instanceof Object].join();';
console.log(new Function(text)());
