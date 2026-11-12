// Nothing that a build replaces is replaced in a string.
const env = eval("(function () { return process.env.NODE_ENV + typeof process.env.HOME; })");
console.log(env());
const f = eval("(function () { return typeof SETTING; })"); console.log(f());
const g = eval("(function () { console.log('kept'); return Bun.version.length > 3; })"); console.log(g());
const h = eval("(function () { return typeof window + typeof document + typeof self + typeof global + typeof globalThis; })"); console.log(h());
