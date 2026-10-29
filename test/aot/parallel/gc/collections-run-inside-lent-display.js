// One factory makes function objects that are given a displayName through a value that came back out of code made at run time, and function objects that are only handed to whoever calls them. A full collection runs inside the calls, and each frame shows the name of its function object.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function nameInFrame() {
  return new Error("x").stack.split("\n")[2].trim().split(" ")[1];
}
function each(list, callback) {
  for (let i = 0; i < list.length; i++) callback(list[i]);
}
function eachTwoCallsDeep(list, callback) {
  each(list, callback);
}
function makeArrow(state) {
  return x => {
    state.sum += x;
    if (x === 2) {
      Bun.gc(true);
      state.name = nameInFrame();
    }
  };
}
function makeFunction(state) {
  return function add(x) {
    state.sum += x;
    if (x === 2) {
      Bun.gc(true);
      state.name = nameInFrame();
    }
  };
}
function display(made, name) {
  handedBack(made).displayName = name;
  return made;
}

function lent(make, list) {
  const state = { sum: 0, name: "" };
  each(list, make(state));
  return state.name + state.sum;
}
function lentArrow(list) {
  const state = { sum: 0, name: "" };
  each(list, makeArrow(state));
  return state.name + state.sum;
}
function lentFunction(list) {
  const state = { sum: 0, name: "" };
  each(list, makeFunction(state));
  return state.name + state.sum;
}
function lentTwoCallsDeep(list) {
  const state = { sum: 0, name: "" };
  eachTwoCallsDeep(list, makeFunction(state));
  return state.name + state.sum;
}
function calledInPlace(list) {
  const state = { sum: 0, name: "" };
  const add = makeFunction(state);
  add(list[0]);
  add(list[1]);
  return state.name + state.sum;
}
function lentToABuiltIn(list) {
  const state = { sum: 0, name: "" };
  list.forEach(makeFunction(state));
  return state.name + state.sum;
}
function displayedOnOneWay(list, name) {
  const state = { sum: 0, name: "" };
  const add = makeFunction(state);
  if (name) display(add, name);
  each(list, add);
  return state.name + state.sum;
}
function kept(made, list) {
  each(list, made.add);
  return made.state.name + made.state.sum;
}
function keep(make) {
  const state = { sum: 0, name: "" };
  return { state, add: make(state) };
}

function round(i) {
  const list = [1, 2, 3, i];
  return [
    lentArrow(list),
    lentFunction(list),
    lentTwoCallsDeep(list),
    calledInPlace(list),
    lentToABuiltIn(list),
    lent(makeArrow, list),
    lent(makeFunction, list),
    displayedOnOneWay(list, i & 1 ? "odd" : ""),
  ].join(" ");
}

const seen = new Set();
for (let i = 0; i < 20; i++) seen.add(round(i & 3));
console.log("before:", [...seen].sort().join(" | "));

const first = keep(makeFunction);
const second = keep(makeArrow);
const third = keep(makeFunction);
display(first.add, "first");
display(second.add, "second");
seen.clear();
for (let i = 0; i < 20; i++) {
  const list = [1, 2, 3];
  first.state.sum = second.state.sum = third.state.sum = 0;
  seen.add(
    [
      kept(first, list),
      lentFunction(list),
      kept(second, list),
      lentArrow(list),
      kept(third, list),
      round(i & 3),
      kept(first, list),
    ].join(" "),
  );
}
console.log("after:", [...seen].sort().join(" | "));
