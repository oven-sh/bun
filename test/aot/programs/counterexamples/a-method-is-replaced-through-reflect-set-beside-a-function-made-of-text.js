// Reflect.set puts a text, a boolean or undefined under the name of a method that nobody has read, in a program that also makes a function out of text.
const launder = new Function("value", process.argv[9] ?? "return value");
function run(y) { const o = { n() { return 1; } }; Reflect.set(o, "n", y); return o.n; }
console.log(run(launder("")), run(true), run(undefined), run("a"));
