// Function objects of one function call each other down to many depths: some were given a displayName through a value that came back out of code made at run time, the others are only handed to whoever calls them. A full collection runs at the bottom, and every frame shows the name of its function object.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
Error.stackTraceLimit = 1000;
function namesInFrames() {
  let text = "";
  let last = "";
  let run = 0;
  for (const line of new Error("x").stack.split("\n").slice(2)) {
    const name = line.trim().split(" ")[1];
    if (name !== "step" && !name.startsWith("shown")) continue;
    if (name === last) {
      run++;
      continue;
    }
    if (last) text += last + "*" + run + " ";
    last = name;
    run = 1;
  }
  return text + last + "*" + run;
}
function call(callback, depth) {
  return callback(depth) + 0;
}
const state = { names: "", every: 3, collects: true };
const shown = [];
function make(state) {
  return function step(depth) {
    return descend(state, depth - 1) + 1;
  };
}
function descend(state, depth) {
  if (depth <= 0) {
    if (state.collects) Bun.gc(true);
    state.names = namesInFrames();
    return 0;
  }
  if (shown.length && depth % state.every === 0) return call(shown[depth % shown.length], depth) + 0;
  return call(make(state), depth) + 0;
}

console.log(descend(state, 5), state.names);
for (let i = 0; i < 4; i++) {
  const made = make(state);
  handedBack(made).displayName = "shown" + i;
  shown.push(made);
}
for (const depth of [1, 2, 3, 7, 40, 300, 41, 6, 300, 2]) {
  for (const every of [1, 2, 3, 5, 1000]) {
    state.every = every;
    state.collects = depth < 100 || every === 3;
    console.log(
      depth,
      every,
      descend(state, depth),
      state.names.length > 200 ? Bun.hash(state.names).toString(36) : state.names,
    );
  }
}
delete handedBack(shown[1]).displayName;
handedBack(shown[2]).displayName = "shownAgain";
state.every = 1;
console.log(descend(state, 9), state.names);
shown.length = 0;
Bun.gc(true);
console.log(descend(state, 9), state.names);
