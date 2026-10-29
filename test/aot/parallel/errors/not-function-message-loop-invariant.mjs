// Not a function message for loop invariant callee.
// Flags: --aot-heat=everything-is-hot
const show = (label, run) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.name, error.message.replace(/\(In '([^(]*)\(.*\)', /, "(In '$1()', "));
  }
};
const notCallable = Object.create(Function.prototype);
const plainObject = {};
function value(f) {
  return f();
}
function member(o) {
  return o.f();
}
function deepMember(o) {
  return o.deep.f(1);
}
function kept(f) {
  const result = f(1, 2);
  return [result];
}
function keptMember(o) {
  const result = o.f(1, 2);
  return [result];
}
for (let i = 0; i < 3; i++) {
  show("value", () => value(notCallable));
  show("value of an object", () => value(plainObject));
  show("member", () => member({ f: notCallable }));
  show("member of an object", () => member({ f: plainObject }));
  show("deepMember", () => deepMember({ deep: { f: notCallable } }));
  show("kept", () => kept(notCallable));
  show("keptMember", () => keptMember({ f: notCallable }));
}
function inItsOwnLoop(f, o) {
  const messages = [];
  for (let i = 0; i < 3; i++) {
    try {
      f(i);
    } catch (error) {
      messages.push(error.message.replace(/\(In '([^(]*)\(.*\)', /, "(In '$1()', "));
    }
    try {
      o.f(i);
    } catch (error) {
      messages.push(error.message.replace(/\(In '([^(]*)\(.*\)', /, "(In '$1()', "));
    }
  }
  return messages.join("\n");
}
console.log(inItsOwnLoop(notCallable, { f: notCallable }));
console.log(inItsOwnLoop(plainObject, { f: 5 }));
