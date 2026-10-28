// The arguments object of a sloppy function follows its parameters. In a spread, a for-of, a pattern and a call it holds what the parameters hold at that moment.
const show = value => JSON.stringify(value, (key, member) => (member === undefined ? "undefined" : member));

function spread(a, b) {
  return [...arguments];
}
function parameterStored(a, b, c) {
  b = "stored";
  return [...arguments];
}
function parameterThatWasNotPassedStored(a, b) {
  b = "stored";
  return [...arguments];
}
function memberStored(a, b) {
  arguments[0] = "stored";
  return [a, [...arguments]];
}
function parameterStoredWhileWalked(a, b, c) {
  const seen = [];
  for (const value of arguments) {
    seen.push(value);
    c = "stored";
  }
  return seen;
}
function parameterStoredByAClosure(a, b) {
  const store = () => {
    a = "stored";
  };
  store();
  return [...arguments];
}
function takeApart(a, b) {
  a = "stored";
  const [first, second, third] = arguments;
  return [first, second, third];
}
function target() {
  return arguments.length + ":" + Array.prototype.join.call(arguments);
}
function passOn(a, b) {
  a = "stored";
  return target(...arguments);
}
function calleeRead(a) {
  return [typeof arguments.callee, [...arguments]];
}
function lengthLowered(a, b) {
  arguments.length = 1;
  b = "stored";
  return [...arguments];
}
function iteratorReplaced(a) {
  arguments[Symbol.iterator] = function* () {
    yield "own";
  };
  return [...arguments];
}
function memberRemoved(a, b) {
  delete arguments[0];
  a = "stored";
  return [...arguments];
}
function named(arguments) {
  return [...arguments];
}

for (let turn = 0; turn < 3; turn++) {
  console.log(show(spread()), show(spread(1)), show(spread(1, 2, 3)));
  console.log(
    show(parameterStored(1, 2, 3)),
    show(parameterStored(1)),
    show(parameterThatWasNotPassedStored(1)),
    show(memberStored(1, 2)),
  );
  console.log(
    show(parameterStoredWhileWalked(1, 2, 3)),
    show(parameterStoredByAClosure(1, 2)),
    show(takeApart(1, 2, 3)),
    passOn(1, 2),
    passOn(),
  );
  console.log(
    show(calleeRead(1)),
    show(lengthLowered(1, 2)),
    show(iteratorReplaced(1)),
    show(memberRemoved(1, 2)),
    show(named("ab")),
  );
}
