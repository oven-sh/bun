// What is called is no function: the message names the callee as it is written, also where the arguments of the caller are handed on.
// What only plain Bun quotes is left out of each message: the text of the arguments, and the expression behind "evaluating".
function tell(label, run) {
  try {
    run();
    console.log(label + ": no error");
  } catch (error) {
    const message = error.message
      .replace(/\(In '([^(']*)\([^']*\)'/, "(In '$1()'")
      .replace(/ \(evaluating '[^']*'\)/, "");
    console.log(label + ": " + error.constructor.name + ": " + message);
  }
}
const kinds = {
  number: 5,
  text: "text",
  plain: {},
  inherits: Object.create(Function.prototype),
  list: [],
  proxy: new Proxy({}, {}),
  symbol: Symbol("s"),
};
function applyOwnArguments(f) {
  return f.apply(this, arguments);
}
function applyRest(f, ...rest) {
  return f.apply(this, rest);
}
function applyRestThenMore(f, ...rest) {
  const result = f.apply(this, rest);
  return [result];
}
function applyOwnArgumentsThenMore(f) {
  const result = f.apply(null, arguments);
  return [result];
}
function applyOfMember(holder, ...rest) {
  return holder.f.apply(holder, rest);
}
function applyOfDeepMember(holder) {
  return holder.inner.f.apply(holder, arguments);
}
function spreadRest(f, ...rest) {
  return f(...rest);
}
function spreadOwnArguments(f) {
  return f(...arguments);
}
function spreadIntoMember(holder, ...rest) {
  return holder.f(...rest);
}
function spreadIntoMissing(holder, ...rest) {
  return holder.missing(...rest);
}
function spreadIntoNew(f, ...rest) {
  return new f(...rest);
}
function callRest(f, ...rest) {
  return f.call(this, ...rest);
}
function callOne(f) {
  return f.call(null, 1);
}
function bindOne(f) {
  return f.bind(null, 1);
}
function bindRest(f, ...rest) {
  return f.bind(null, ...rest);
}
function bindApplied(f) {
  return f.bind.apply(f, arguments);
}
function reflectRest(f, ...rest) {
  return Reflect.apply(f, this, rest);
}
function inTry(f, ...rest) {
  try {
    return f.apply(this, rest);
  } finally {
    kinds.number++;
  }
}
const arrow = (f, ...rest) => f.apply(null, rest);
class Base {
  static run(f, ...rest) {
    return f.apply(this, rest);
  }
  run(f) {
    return f.apply(this, arguments);
  }
}
class Derived extends Base {
  run(...rest) {
    return super.missing(...rest);
  }
  other(...rest) {
    return super.missing.apply(this, rest);
  }
}
for (let round = 0; round < 2; round++) {
  for (const kind of Object.keys(kinds)) {
    const f = kinds[kind];
    tell(kind + " applyOwnArguments", () => applyOwnArguments(f, 1));
    tell(kind + " applyRest", () => applyRest(f, 1, 2));
    tell(kind + " applyRestThenMore", () => applyRestThenMore(f, 1, 2));
    tell(kind + " applyOwnArgumentsThenMore", () => applyOwnArgumentsThenMore(f, 1));
    tell(kind + " applyOfMember", () => applyOfMember({ f }, 1));
    tell(kind + " applyOfDeepMember", () => applyOfDeepMember({ inner: { f } }, 1));
    tell(kind + " spreadRest", () => spreadRest(f, 1, 2));
    tell(kind + " spreadOwnArguments", () => spreadOwnArguments(f, 1));
    tell(kind + " spreadIntoMember", () => spreadIntoMember({ f }, 1));
    tell(kind + " spreadIntoNew", () => spreadIntoNew(f, 1));
    tell(kind + " callRest", () => callRest(f, 1, 2));
    tell(kind + " callOne", () => callOne(f));
    tell(kind + " bindOne", () => bindOne(f));
    tell(kind + " bindRest", () => bindRest(f, 1, 2));
    tell(kind + " bindApplied", () => bindApplied(f, 1));
    tell(kind + " reflectRest", () => reflectRest(f, 1, 2));
    tell(kind + " inTry", () => inTry(f, 1, 2));
    tell(kind + " arrow", () => arrow(f, 1, 2));
    tell(kind + " static method", () => Base.run(f, 1, 2));
    tell(kind + " method", () => new Base().run(f, 1));
  }
  tell("spreadIntoMissing", () => spreadIntoMissing({}, 1));
  tell("super.missing", () => new Derived().run(1, 2));
  tell("super.missing.apply", () => new Derived().other(1, 2));
}
