// Each line: the message where what `call` is called on is no function: it names the member that was called, as written.
const show = (label, run) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.name, error.message.replace(/\(In '([^(]*)\(.*\)', /, "(In '$1()', "));
  }
};
const notCallable = Object.create(Function.prototype);
const holder = { f: notCallable, deep: { f: notCallable } };
function kept(f) {
  const result = f.call(null, 1);
  return [result];
}
function member(o) {
  const result = o.f.call(o, 1);
  return [result];
}
function deep(o) {
  const result = o.deep.f.call(o, 1, 2, 3);
  return [result];
}
function bracket(f) {
  const result = f["call"](null, 1);
  return [result];
}
function chain(f) {
  const result = f?.call(null, 1);
  return [result];
}
function noArguments(f) {
  const result = f.call();
  return [result];
}
function spread(f, list) {
  const result = f.call(null, ...list);
  return [result];
}
function throughCall(f) {
  const result = Function.prototype.call.call(f, null, 1);
  return [result];
}
function throughVariable(f) {
  const call = Function.prototype.call;
  const bound = call.bind(f);
  return [bound(null, 1), call];
}
function bound(f) {
  const result = f.bind(null);
  return [result];
}
function text(f) {
  const result = f.toString();
  return [result];
}
for (let round = 0; round < 3; round++) {
  show("kept", () => kept(notCallable));
  show("member", () => member(holder));
  show("deep", () => deep(holder));
  show("bracket", () => bracket(notCallable));
  show("chain", () => chain(notCallable));
  show("noArguments", () => noArguments(notCallable));
  show("spread", () => spread(notCallable, [1, 2]));
  show("throughCall", () => throughCall(notCallable));
  show("throughVariable", () => throughVariable(notCallable));
  show("bound", () => bound(notCallable));
  show("text", () => text(notCallable));
  show("a function", () =>
    kept(function (value) {
      return [this, value];
    }).join(),
  );
}
