function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "function" ? "function" : String(value);
}
function say(label, run) {
  let text;
  try {
    text = show(run());
  } catch (error) {
    text = error.name;
  }
  console.log(label + ": " + text);
}
var x = "outer";
const texts = [
  "var a; a",
  "var a; typeof a",
  "var a; a = 5; a",
  "var a; delete a",
  "var a, b; [a, b]",
  "{ var a; } a",
  "for (var a in {}); a",
  "var arguments; typeof arguments",
  "var arguments; delete arguments",
  "a",
  "a = 6; a",
  "delete a",
  "typeof arguments",
];
for (const text of texts) {
  say("rest | " + text, () => (function (a, ...b) { return [eval(text), a, typeof arguments]; })(1));
  say("pattern | " + text, () => (function (a, { b }) { return [eval(text), a, typeof arguments]; })(1, {}));
  say("list | " + text, () => (function (a, [b]) { return [eval(text), a, typeof arguments]; })(1, []));
  say("pattern of a | " + text, () => (function ({ a }) { return [eval(text), a, typeof arguments]; })({ a: 1 }));
  say("list of a | " + text, () => (function ([a], b) { return [eval(text), a, typeof arguments]; })([1]));
  say("rest named a | " + text, () => (function (...a) { return [eval(text), a, typeof arguments]; })(1));
  say("arrow | " + text, () => ((a, ...b) => [eval(text), a])(1));
  say("arrow with a body | " + text, () => ((a, ...b) => { return [eval(text), a]; })(1));
  say("method | " + text, () => ({ m(a, ...b) { return [eval(text), a, typeof arguments]; } }).m(1));
  say("generator | " + text, () => (function* (a, ...b) { yield [eval(text), a, typeof arguments]; })(1).next().value);
  say("closure | " + text, () => (function (a, ...b) { const read = () => a; return [eval(text), a, read()]; })(1));
  say("store | " + text, () => (function (a, ...b) { const first = eval(text); a = 9; return [first, a, eval("a")]; })(1));
  say("removed | " + text, () => (function (a, ...b) { const first = eval(text); return [first, delete a, a, eval("a")]; })(1));
  say("twice | " + text, () => (function (a, ...b) { return [eval(text), eval(text), a]; })(1));
  say("own var | " + text, () => (function (a, ...b) { var a; return [eval(text), a, typeof arguments]; })(1));
  say("own var with a value | " + text, () => (function (a, ...b) { var a = 3; return [eval(text), a]; })(1));
  say("own function | " + text, () => (function (a, ...b) { function a() {} return [eval(text), a]; })(1));
  say("own arguments | " + text, () => (function (a, ...b) { var arguments; return [eval(text), a, typeof arguments]; })(1));
  say("in a block | " + text, () => (function (a, ...b) { { return [eval(text), a]; } })(1));
  say("in a closure | " + text, () => (function (a, ...b) { return [(() => eval(text))(), a]; })(1));
  say("simple | " + text, () => (function (a, b) { return [eval(text), a, typeof arguments]; })(1));
  say("default | " + text, () => (function (a, b = 2) { return [eval(text), a, typeof arguments]; })(1));
}
