// One factory makes function objects that get a name of their own and function objects that are only handed to whoever calls them. A full collection runs inside the calls of the latter, and each frame shows the name of its function object.
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
    if (x === 2) Bun.gc(true);
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
function rename(made, name) {
  return Object.defineProperty(made, "name", { value: name });
}

function lent(list) {
  const state = { sum: 0 };
  each(list, makeArrow(state));
  return state.sum;
}
function lentTwoCallsDeep(list) {
  const state = { sum: 0 };
  eachTwoCallsDeep(list, makeArrow(state));
  return state.sum;
}
function calledInPlace(list) {
  const state = { sum: 0 };
  const add = makeArrow(state);
  add(list[0]);
  add(list[1]);
  return state.sum;
}
function lentToABuiltIn(list) {
  const state = { sum: 0 };
  list.forEach(makeArrow(state));
  return state.sum;
}
function lentWithAName(list) {
  const state = { sum: 0, name: "" };
  each(list, makeFunction(state));
  return state.name + state.sum;
}
function lentUnderAKey(list, key) {
  let sum = 0;
  const holder = {
    [key]: x => {
      sum += x;
      if (x === 2) Bun.gc(true);
    },
  };
  each(list, holder[key]);
  return sum;
}
function renamedOnOneWay(list, name) {
  const state = { sum: 0, name: "" };
  const add = makeFunction(state);
  if (name) rename(add, name);
  each(list, add);
  return state.name + state.sum;
}

const kept = [
  rename(makeArrow({ sum: 0 }), "first"),
  rename(makeArrow({ sum: 0 }), "second"),
  rename(makeFunction({ sum: 0 }), "third"),
];
const sums = [0, 0, 0, 0, 0];
const names = new Set();
for (let i = 0; i < 20; i++) {
  const list = [1, 2, 3, i];
  sums[0] += lent(list);
  sums[1] += lentTwoCallsDeep(list);
  sums[2] += calledInPlace(list);
  sums[3] += lentToABuiltIn(list);
  sums[4] += lentUnderAKey(list, "key" + (i & 1));
  names.add(lentWithAName(list)).add(renamedOnOneWay(list, i & 1 ? "odd" + i : ""));
}
console.log(sums.join(), kept.map(made => made.name).join());
console.log([...names].join());
