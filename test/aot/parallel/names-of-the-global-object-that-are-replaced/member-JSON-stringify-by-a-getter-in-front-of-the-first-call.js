// Made by test/aot/tools/generate-names-of-the-global-object-that-are-replaced.py.
let reads = 0;
let kept;
let pick = 1;
function mark(holder, name) {
  holder[name] = () => "mine";
}
function change() {
  Object.defineProperty(JSON, "stringify", { get() { reads++; return () => "mine"; }, configurable: true });
}
const handlers = {
  asked(value) {
    return JSON.stringify(value);
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
const values = [{ a: 1 }, [1, "b"], undefined];
for (let turn = 0; turn < 4; turn++) {
  if (turn === 0) change();
  for (let at = 0; at < values.length; at++) console.log(turn, safely(values[at]), reads);
}
