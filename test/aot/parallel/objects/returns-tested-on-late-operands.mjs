// A helper returns its operand or a closure, by a test of the operand. One call passes the property of an object that the global object gets later, so only unseen code stores what passes the test.
// Under: --aot-check=FlowFixpoint: the call also enters unseen code. It was not resolved again when its operand held more primitives, and the closure was missing in its result.
const own = input => {
  if (input === undefined) return input;
  const held = input;
  return suffix => "made " + held + suffix;
};
const other = { normalize: undefined };
const options = { late: undefined };
let afterFirst, afterSecond, afterThird, kept;
const out = [];

function ask() {
  kept = (other.normalize ?? own)(options.late);
  return kept === undefined ? "none" : kept("!");
}
function shareOther() {
  globalThis.other = other;
}
function first() {
  afterFirst = second;
  afterFirst();
}
function second() {
  afterSecond = third;
  afterSecond();
}
function third() {
  afterThird = () => {
    globalThis.options = options;
  };
  afterThird();
}

out.push(ask());
shareOther();
out.push(ask());
first();
const name = JSON.parse('["options"]')[0];
for (const value of [5, "text", true, undefined, 2.5, null]) {
  globalThis[name].late = value;
  out.push(ask());
}
globalThis.other.normalize = input => () => "other " + input;
out.push(ask());
console.log(out.join("\n"));
