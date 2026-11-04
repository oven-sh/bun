// Made by test/aot/tools/generate-names-of-the-global-object-that-are-replaced.py.
let reads = 0;
let kept;
let pick = 1;
function mark(holder, name) {
  holder[name] = function () { return { message: "mine" }; };
}
function change() {
  Object.defineProperty(globalThis, "Error", { get() { reads++; return function () { return { message: "mine" }; }; }, configurable: true });
}
const handlers = {
  asked(value) {
    return new Error((change(), value)).message;
  },
};
const names = ["asked"];
function safely(value) {
  try {
    return String(handlers[names[0]](value));
  } catch (error) {
    return "thrown: " + error.name;
  }
}
const values = ["e", undefined];
for (let turn = 0; turn < 4; turn++) {
  if (turn === -1) change();
  for (let at = 0; at < values.length; at++) console.log(turn, safely(values[at]), reads);
}
