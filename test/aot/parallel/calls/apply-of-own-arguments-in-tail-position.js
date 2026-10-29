// `return f.apply(this, arguments)` passes on exactly what the function was called with, whatever was done to the parameters and to the object before
function show() {
  return [this === undefined ? "no this" : this.name, arguments.length, ...arguments].map(String).join(" | ");
}

function noParameter() {
  return show.apply(this, arguments);
}
function oneParameter(first) {
  return show.apply(this, arguments);
}
function fourParameters(first, second, third, fourth) {
  return show.apply(this, arguments);
}
function fiveParameters(first, second, third, fourth, fifth) {
  return show.apply(this, arguments);
}
function parameterIsAssigned(first, second) {
  first = "assigned";
  second = first + "!";
  return show.apply(this, arguments);
}
function elementIsStored(first, second) {
  arguments[0] = "stored";
  return show.apply(this, arguments);
}
function elementIsAdded(first) {
  arguments[arguments.length] = "added";
  return show.apply(this, arguments);
}
function lengthIsStored(first, second) {
  arguments.length = 1;
  return show.apply(this, arguments);
}
function change(list) {
  list[1] = "changed";
  list.length = 3;
}
function objectIsPassedBefore(first, second) {
  change(arguments);
  return show.apply(this, arguments);
}
function objectIsPassedOnAnotherPath(first, second) {
  if (first === "other") {
    change(arguments);
    return Array.prototype.join.call(arguments, " , ");
  }
  return show.apply(this, arguments);
}
function objectIsReadBefore(first, second) {
  const read = arguments.length + ":" + arguments[1] + ":" + arguments[7];
  if (read.length > 100) return read;
  return show.apply(this, arguments);
}
function objectIsAlsoTheReceiver(first) {
  return describeReceiver.apply(arguments, arguments);
}
function describeReceiver() {
  this[0] = "receiver";
  return Array.prototype.join.call(this, " , ") + " <- " + Array.prototype.join.call(arguments, " , ");
}
function calleeIsChosen(callee, value) {
  return callee.apply(this, arguments);
}

const receiver = { name: "receiver" };
const wrappers = [
  noParameter, oneParameter, fourParameters, fiveParameters, parameterIsAssigned, elementIsStored, elementIsAdded, lengthIsStored,
  objectIsPassedBefore, objectIsPassedOnAnotherPath, objectIsReadBefore, objectIsAlsoTheReceiver,
];
const lists = [[], [undefined], ["a"], ["a", "b"], ["other", "b"], ["a", undefined, "c"], ["a", "b", "c", "d"], ["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e", "f", "g"]];
for (let round = 0; round < 3; round++) {
  for (const wrapper of wrappers) {
    for (const list of lists) {
      const withReceiver = wrapper.call(receiver, ...list);
      const withoutReceiver = wrapper(...list);
      if (!round) console.log(wrapper.name, "(" + list.length + ")", withReceiver, "//", withoutReceiver);
    }
  }
}

for (const callee of [show, undefined, null, 1, "text", {}, Symbol.iterator]) {
  try {
    console.log(typeof callee, calleeIsChosen(callee, "value").endsWith(" | value"));
  } catch (error) {
    console.log(typeof callee, error.constructor === TypeError);
  }
}

function countDown(remaining, steps) {
  if (!remaining) return steps;
  return countDownAgain.apply(this, arguments);
}
function countDownAgain(remaining, steps) {
  return countDown(remaining - 1, steps + 1);
}
console.log(countDown(300000, 0));
