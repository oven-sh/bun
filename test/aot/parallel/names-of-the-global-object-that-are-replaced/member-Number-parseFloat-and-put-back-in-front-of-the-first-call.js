// Made by test/aot/tools/generate-names-of-the-global-object-that-are-replaced.py.
let reads = 0;
let kept;
let pick = 1;
function mark(holder, name) {
  holder[name] = () => "mine";
}
function change() {
  if (kept === undefined) { kept = Number.parseFloat; Number.parseFloat = () => "mine"; } else { Number.parseFloat = kept; kept = undefined; }
}
const handlers = {
  asked(value) {
    return Number.parseFloat(value);
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
const values = ["4.5", "x"];
for (let turn = 0; turn < 4; turn++) {
  if (turn === 0) change();
  for (let at = 0; at < values.length; at++) console.log(turn, safely(values[at]), reads);
}
