// `_getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (..) { .. }`: a declaration that replaces itself at its first call with a built-in
// bound to nothing, as the helpers of Babel do. Whoever calls the variable calls the built-in.
// COUNT: arrivals <= 150
"use strict";
function _getPrototypeOf(t) {
  return (
    (_getPrototypeOf = Object.setPrototypeOf
      ? Object.getPrototypeOf.bind()
      : function (t) {
          return t.__proto__ || Object.getPrototypeOf(t);
        }),
    _getPrototypeOf(t)
  );
}
const isList = Array.isArray.bind();
const most = Math.max.bind(undefined);
function Base() {}
Base.prototype.kind = 3;
const made = new Base();
const list = [1];
let sum = 0;
for (let turn = 0; turn < 1000; turn++) {
  sum += _getPrototypeOf(made).kind;
  sum += isList(list) ? 1 : 0;
  sum += most(turn & 3, 2);
}
console.log(sum);

const lines = [];
function say(name, make) {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  lines.push(name + ": " + String(answer));
}
// In each of these something else may reach the call.
let oneOfTwoTargets = Math.max.bind();
say("another target is stored later", () => {
  const first = oneOfTwoTargets(1, 2);
  oneOfTwoTargets = Math.min.bind();
  return first + " " + oneOfTwoTargets(1, 2);
});
let bindsLater = Array.prototype.join.bind();
say("something is bound later", () => {
  let first;
  try {
    first = bindsLater("-");
  } catch (error) {
    first = error.constructor.name;
  }
  bindsLater = Array.prototype.join.bind([1, 2]);
  return first + " " + bindsLater("-");
});
let bindsArgumentLater = Math.max.bind();
say("an argument is bound later", () => {
  const first = bindsArgumentLater(1);
  bindsArgumentLater = Math.max.bind(undefined, 9);
  return first + " " + bindsArgumentLater(1);
});
function double(value) {
  return value * 2;
}
let builtinOrOwn = Math.abs.bind();
say("a function of the program is bound later", () => {
  const first = builtinOrOwn(-4);
  builtinOrOwn = double.bind();
  return first + " " + builtinOrOwn(-4);
});
let boundOrClosure = Math.abs.bind();
say("a closure is stored later", () => {
  const first = boundOrClosure(-4);
  boundOrClosure = value => value + 1;
  return first + " " + boundOrClosure(-4);
});
let boundOrNothing = Math.abs.bind();
say("nothing callable is stored later", () => {
  const first = boundOrNothing(-4);
  boundOrNothing = 5;
  return first + " " + boundOrNothing(-4);
});
let boundTwice = Math.max.bind().bind(undefined, 7);
say("bound twice", () => boundTwice(1));
const nullBound = Object.keys.bind(null);
say("null is bound", () => nullBound({ a: 1 }).join());
const needsReceiver = Array.prototype.slice.bind();
say("the built-in asks for a receiver", () => needsReceiver(1));
const holder = { keys: Object.keys.bind(), own: 1 };
say("called as a member", () => holder.keys(holder).join());
const kept = Object.assign.bind();
say("by apply, call and spread", () => [kept.apply(null, [{}, { a: 1 }]).a, kept.call({ b: 1 }, {}, { a: 2 }).a, kept(...[{}, { a: 3 }]).a, Reflect.apply(kept, 1, [{}, { a: 4 }]).a].join());
function inTailPosition(value) {
  return kept({}, value);
}
say("in tail position", () => inTailPosition({ a: 5 }).a);
say("what it is", () => [kept.name, kept.length, kept === Object.assign, typeof kept, Object.prototype.hasOwnProperty.call(kept, "prototype")].join());
say("constructed", () => new kept());
const Lists = Array.bind();
say("a constructor", () => [new Lists(2).length, Lists(3).length, new Lists(1, 2).join()].join());
globalThis[process.argv.length > 99 ? "never" : "handedOver"] = kept;
say("handed over", () => globalThis.handedOver({}, { a: 6 }).a);
say("the frames of an error", () => {
  try {
    kept(undefined);
  } catch (error) {
    return error.stack
      .split("\n")
      .slice(0, 2)
      .map(line => line.trim().replace(/\(.*[\\/]/, "("))
      .join(" | ");
  }
});
console.log(lines.join("\n"));
