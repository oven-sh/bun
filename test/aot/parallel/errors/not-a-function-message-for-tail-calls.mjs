const framesOf = error =>
  String(error.stack)
    .split("\n")
    .filter(line => /^\s+at /.test(line))
    .slice(0, 2)
    .map(line => line.trim().replace(/\(?[^\s(]*[\\/]([^\\/\s:]+:\d+:\d+)\)?/, "$1"))
    .join(" < ");
const show = (label, run, describe = framesOf) => {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(
      label,
      error.name,
      error.message.replace(/\(In '([^(]*)\(.*\)', /, "(In '$1()', "),
      "|",
      describe(error),
    );
  }
};
function answers(...list) {
  return "answers " + [typeof this, ...list].join();
}
function withMembers() {
  return "a function with members of its own";
}
withMembers.extra = 1;
class Class {}
const replaced = function () {};
replaced.call = 5;
replaced.apply = undefined;
const revocable = Proxy.revocable(answers, {});
revocable.revoke();
// Parsed at run time so the compiler cannot tell which value each function receives.
const kinds = JSON.parse(
  '["function","members","bound","host","arrow","class","proxy","proxyOfObject","revoked","inherits","object","number","text","symbol","ownCall","ownCallWithMembers","ownBoundCall","ownHostCall","replaced"]',
);
const values = {
  function: answers,
  members: withMembers,
  bound: answers.bind(null, "bound"),
  host: Math.max,
  arrow: () => "arrow",
  class: Class,
  proxy: new Proxy(answers, {}),
  proxyOfObject: new Proxy({}, {}),
  revoked: revocable.proxy,
  inherits: Object.create(Function.prototype),
  object: {},
  number: 5,
  text: "text",
  symbol: Symbol.iterator,
  ownCall: { call: (...list) => "its own call " + list.join(), apply: (...list) => "its own apply " + list.join() },
  ownCallWithMembers: { call: withMembers, apply: withMembers },
  ownBoundCall: { call: answers.bind(1, 2), apply: answers.bind(1, 2) },
  ownHostCall: { call: Math.max, apply: Math.max },
  replaced,
};
function value(f) {
  return f();
}
function member(o) {
  return o.f();
}
function deepMember(o) {
  return o.deep.f(1, 2);
}
function spread(f, list) {
  return f(...list);
}
function callWithoutArguments(f) {
  return f.call();
}
function callWithThis(f) {
  return f.call(null);
}
function callWithArguments(f) {
  return f.call(null, 1, 2);
}
function callWithMany(f) {
  return f.call(null, 1, 2, 3, 4, 5, 6, 7);
}
function callWithSpread(f, list) {
  return f.call(null, ...list);
}
function callOfMember(o) {
  return o.f.call(o, 1);
}
function applyWithoutArguments(f) {
  return f.apply();
}
function applyWithThis(f) {
  return f.apply(null);
}
function applyWithList(f, list) {
  return f.apply(null, list);
}
function applyWithLiteral(f) {
  return f.apply(null, [1, 2]);
}
function applyWithOwnArguments(f) {
  return f.apply(this, arguments);
}
function applyOfMember(o) {
  return o.f.apply(o, [1]);
}
function bracket(f) {
  return f["call"](null);
}
function chain(f) {
  return f?.call(null);
}
function eitherArm(f, first) {
  return first ? f.call(null) : f.apply(null);
}
function behindAnd(f, first) {
  return first && f.call(null);
}
function behindComma(f) {
  return (0, f.call(null));
}
const arrow = f => f.call(null);
const holder = {
  method(f) {
    return f.apply(null);
  },
};
class Holder {
  static method(f) {
    return f.call(null);
  }
}
for (let round = 0; round < 2; round++) {
  for (const kind of kinds) {
    const f = values[kind];
    show(kind + " value", () => value(f));
    show(kind + " member", () => member({ f }));
    show(kind + " deepMember", () => deepMember({ deep: { f } }));
    show(kind + " spread", () => spread(f, [1, 2]));
    show(kind + " callWithoutArguments", () => callWithoutArguments(f));
    show(kind + " callWithThis", () => callWithThis(f));
    show(kind + " callWithArguments", () => callWithArguments(f));
    show(kind + " callWithMany", () => callWithMany(f));
    show(
      kind + " callWithSpread",
      () => callWithSpread(f, [1, 2]),
      () => "",
    );
    show(kind + " callOfMember", () => callOfMember({ f }));
    show(kind + " applyWithoutArguments", () => applyWithoutArguments(f));
    show(kind + " applyWithThis", () => applyWithThis(f));
    show(kind + " applyWithList", () => applyWithList(f, [1, 2]));
    show(kind + " applyWithLiteral", () => applyWithLiteral(f));
    show(kind + " applyWithOwnArguments", () => applyWithOwnArguments(f));
    show(kind + " applyOfMember", () => applyOfMember({ f }));
    show(kind + " bracket", () => bracket(f));
    show(kind + " chain", () => chain(f));
    show(kind + " eitherArm", () => eitherArm(f, true));
    show(kind + " eitherArm", () => eitherArm(f, false));
    show(kind + " behindAnd", () => behindAnd(f, true));
    show(kind + " behindComma", () => behindComma(f));
    show(kind + " arrow", () => arrow(f));
    show(kind + " method", () => holder.method(f));
    show(kind + " static method", () => Holder.method(f));
  }
}
function byCall(n) {
  return n ? byCall.call(null, n - 1) : "by call";
}
function byApply(n) {
  return n ? byApply.apply(null, [n - 1]) : "by apply";
}
function byOwnArguments(n) {
  if (!n) return "by its own arguments";
  arguments[0] = n - 1;
  return byOwnArguments.apply(this, arguments);
}
const byOwnCall = {
  call(n) {
    return n ? byOwnCall.call(n - 1) : "by a method named call";
  },
};
show("chain", () => byCall(300000));
show("chain", () => byApply(300000));
show("chain", () => byOwnArguments(300000));
show("chain", () => byOwnCall.call(300000));
