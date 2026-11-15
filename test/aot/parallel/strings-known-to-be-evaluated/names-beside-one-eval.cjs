// The free names of a function that an eval makes: no eval can declare them where it is the only one of its function, and one that runs again or stands beside others can.
globalThis.given = "global";
const log = [];
const say = f => log.push(typeof f === "function" ? f() : typeof f);
function alone(x) {
  return eval("(function () { return given + typeof Date + typeof x; })");
}
function beside(x) {
  const f = eval("(function () { return given + typeof Date + typeof x; })");
  eval("var given = 'evaluated', Date = 1");
  return f;
}
function before(x) {
  eval("var given = 'before'");
  return eval("(function () { return given + typeof x; })");
}
function repeated(x) {
  const made = [];
  for (let i = 0; i < 3; i++) made.push(eval(i === 1 ? "var given = 'in a loop'" : "(function () { return given + typeof i; })"));
  return made;
}
function again(x) {
  let made, turn = 0;
  do made = eval(turn ? "var given = 'again'; made" : "(function () { return given + turn; })");
  while (turn++ < 1);
  return made;
}
const arrow = x => {
  const declare = () => eval("var given = 'in the arrow'");
  declare();
  return eval("(() => given + typeof x)");
};
function changing(x, text) {
  const f = eval(text ?? "(function () { return given + typeof x; })");
  return typeof f === "function" ? f : () => given;
}
function* suspended(x) {
  const f = eval("(function () { return given + x; })");
  yield f;
  yield f;
}
function inner(x) {
  function nested() {
    eval("var given = 'nested'");
    return given;
  }
  const f = eval("(function () { return given + nested(); })");
  return f;
}
function branches(x) {
  if (x) {
    const given = "in a block";
    return eval("(function () { return given + typeof x; })");
  }
}
say(alone(1));
say(beside(2));
say(before(3));
for (const f of repeated(4)) say(f);
say(again(5));
say(arrow(6));
say(changing(7));
say(changing(8, "var given = 'changed'"));
say(changing(9));
for (const f of suspended(10)) say(f);
say(inner(11));
say(branches(12));
const late = alone("s");
given = "stored";
say(late);
console.log(log.join("|"));
