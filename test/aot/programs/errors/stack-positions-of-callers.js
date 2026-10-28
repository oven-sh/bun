// Prints the line and column of the frame that called a function that throws.
const listFrames = (error, firstLine) =>
  String(error.stack)
    .split("\n")
    .filter(line => /:\d+:\d+\)?$/.test(line))
    .map(line => {
      const [, name, lineNumber, column] = /^\s*at (?:(.*?) \()?.*?:(\d+):(\d+)\)?$/.exec(line);
      return `${name ?? "-"}@${Number(lineNumber) - firstLine}:${column}`;
    });
function check(label, firstLine, run) {
  try {
    run();
    console.log(label, "no error");
  } catch (error) {
    const frames = listFrames(error, firstLine);
    const own = frames.findIndex(frame => frame.startsWith("check@"));
    console.log(label, error.constructor.name, frames.slice(0, own).join(" < "));
  }
}
let five = 5,
  k = "nope";
const n = null,
  u = undefined,
  sym = Symbol("s");
const o = {
  a: null,
  f: 5,
  s: "str",
  arr: [1],
  nested: { deep: null },
  g() {
    return { h: 1 };
  },
  get bad() {
    throw new Error("getter");
  },
  set bad(v) {
    throw new Error("setter");
  },
  m() {
    throw new Error("m");
  },
};
function fail() {
  throw new Error("fail");
}
function F() {
  throw new Error("F");
}
function id(x) {
  return x;
}
// prettier-ignore
check(0, 54, () => { o["" + "m"](); });
// prettier-ignore
check(1, 56, () => {  ({ ...o }); });
// prettier-ignore
check(2, 58, () => {   ({ toString: fail }) + ""; });
// prettier-ignore
check(3, 60, () => { ({ valueOf: fail }) < 1; });
// prettier-ignore
check(4, 62, () => {  ({ [Symbol.toPrimitive]: fail }) * 1; });
// prettier-ignore
check(5, 64, () => {   const [x] = { [Symbol.iterator]: fail }; });
// prettier-ignore
check(6, 66, () => { const [x] = { [Symbol.iterator]() { return { next: fail }; } }; });
// prettier-ignore
check(7, 68, () => {  const [x] = { [Symbol.iterator]() { return { next() { return { done: false }; }, return: fail }; } }; });
