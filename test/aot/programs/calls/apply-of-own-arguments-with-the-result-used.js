// `const result = f.apply(this, arguments)` passes on what the function was called with: inside try, in loops, before changes of the object, with default values, across await and yield
function show() {
  return [this === undefined ? "no this" : this.name, arguments.length, ...arguments].map(String).join(" | ");
}
function thrower(first) {
  throw new Error("thrown with " + arguments.length + " " + first);
}

function resultIsUsed(first, second) {
  const result = show.apply(this, arguments);
  return "<" + result + ">";
}
function caughtHere(first) {
  try {
    const result = thrower.apply(this, arguments);
    return "returned " + result;
  } catch (error) {
    return "caught " + error.message + ", " + arguments.length + " passed";
  }
}
function finallyRuns(first) {
  let text = "";
  try {
    text += show.apply(this, arguments);
  } finally {
    text += " finally " + arguments.length;
  }
  return text;
}
function changedBehindTheCall(first, second) {
  const result = show.apply(this, arguments);
  arguments[0] = "later";
  arguments.length = 1;
  return result + " then " + show.apply(this, arguments);
}
function changedInALoop(first) {
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += show.apply(this, arguments) + "; ";
    arguments[0] = i;
  }
  return text;
}
function keep(list) {
  kept = list;
}
let kept;
function passedBehindTheCall(first, second) {
  const result = show.apply(this, arguments);
  keep(arguments);
  return result + " kept " + kept.length + " " + kept[0] + " " + (kept === arguments);
}
function defaultValues(first = "default", second = first + "!") {
  const result = show.apply(this, arguments);
  return result + " / " + first + " " + second;
}
function twice(first, second) {
  return show.apply(this, arguments) + " & " + show.apply(this, arguments);
}
async function acrossAwait(first, second) {
  const before = show.apply(this, arguments);
  await null;
  first = "assigned";
  const after = show.apply(this, arguments);
  return before + " ~ " + after;
}
function* acrossYield(first, second) {
  yield show.apply(this, arguments);
  second = "assigned";
  yield show.apply(this, arguments);
}

const receiver = { name: "receiver" };
const wrappers = [resultIsUsed, caughtHere, finallyRuns, changedBehindTheCall, changedInALoop, passedBehindTheCall, defaultValues, twice];
const lists = [[], [undefined], ["a"], ["a", "b"], ["a", undefined, "c"], ["a", "b", "c", "d", "e", "f"]];
for (let round = 0; round < 3; round++) {
  for (const wrapper of wrappers) {
    for (const list of lists) {
      const withReceiver = wrapper.call(receiver, ...list);
      const withoutReceiver = wrapper(...list);
      if (!round) console.log(wrapper.name, "(" + list.length + ")", withReceiver, "//", withoutReceiver);
    }
  }
}
for (const list of lists) {
  console.log("acrossAwait", "(" + list.length + ")", await acrossAwait.call(receiver, ...list));
  console.log("acrossYield", "(" + list.length + ")", [...acrossYield.call(receiver, ...list)].join(" ~ "));
}
