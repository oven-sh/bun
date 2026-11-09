// Flags: --react-compiler
// The React Compiler moves a statement out of an argument of `a.b(..)`, and reads `a.b` ahead of it. The call is then `Function.prototype.call.call(method, receiver, ..)`.
function who(suffix = "") {
  return this.name + ":old" + suffix;
}
function other() {
  return this.name + ":new";
}
const make = name => ({ name, who, inner: { name: name + ".inner", who } });

function statementReplacesTheMethod(text) {
  "use memo";
  const named = make(text);
  return named.who((() => { named.who = other; return "!"; })());
}
function receiverIsAPropertyLoad(text) {
  "use memo";
  const outer = make(text);
  return outer.inner.who((() => { outer.inner.who = other; return "!"; })());
}
function statementInASpreadArgument(text) {
  "use memo";
  const named = make(text);
  return named.who(...(() => { named.who = other; return ["!"]; })());
}
function keyIsAMemberThatIsUpdated(text) {
  "use memo";
  const parts = [n => text + ":first:" + n, n => text + ":second:" + n];
  const state = { i: 0 };
  return parts[state.i](state.i++) + state.i;
}
// The method of an array keeps its member call.
function pushBehindAMemberUpdate(text) {
  "use memo";
  const out = [];
  const counter = { n: 0 };
  for (const letter of text) out.push(letter + counter.n++);
  return out.join();
}
for (const run of [statementReplacesTheMethod, receiverIsAPropertyLoad, statementInASpreadArgument, keyIsAMemberThatIsUpdated, pushBehindAMemberUpdate]) {
  console.log(run.name, run("ab"), run("ab"), run("cd"));
}
