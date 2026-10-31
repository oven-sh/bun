// A closure that is renamed out of the compiler's sight is called by value in tail position and in the middle of a function.
// Flags: --aot-check=verify-each-pass --aot-disable=flow:CalleeSets,flow:ExactFunctions,flow:NarrowedTypes
const hide = value => new CustomEvent("hide", { detail: value }).detail;
function make(n) {
  return function inner(x) {
    if (x < 0) throw new Error("negative");
    return x + n;
  };
}
const list = [make(1), make(2)];
Object.defineProperty(hide(list[1]), "name", { value: "renamed" });
function inTheMiddle(call, x) {
  const got = call(x);
  return got + 1;
}
function atTheEnd(call, x) {
  return call(x);
}
let sum = 0;
for (let i = 0; i < 1000; i++) sum += inTheMiddle(list[i & 1], i) + atTheEnd(list[i & 1], i);
console.log(sum);
for (const run of [inTheMiddle, atTheEnd]) {
  try {
    run(list[1], -1);
  } catch (error) {
    const frames = error.stack.split("\n").slice(1, 3);
    console.log(frames.map(line => /^at (\S+) \(/.exec(line.trim())?.[1] ?? "module").join(" < "));
  }
}
