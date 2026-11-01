// A function object is given a displayName, through a value that came back out of code made at run time, while it runs; inside the same call another function object of its function, which is only handed to whoever calls it, runs too.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function namesInFrames() {
  return new Error("x").stack
    .split("\n")
    .slice(2)
    .map(line => line.trim().split(" ")[1])
    .filter(name => name === "step" || name === "displayed")
    .join(",");
}
function call(callback, depth) {
  return callback(depth);
}
function make(state) {
  return function step(depth) {
    if (depth === 2) {
      handedBack(state.self).displayName = "displayed";
      state.lines.push(namesInFrames());
      return inner(state.lines) + 1;
    }
    state.lines.push(namesInFrames());
    return depth;
  };
}
function inner(lines) {
  return call(make({ lines, self: null }), 1);
}
for (let i = 0; i < 3; i++) {
  const state = { lines: [], self: null };
  state.self = make(state);
  call(state.self, 2);
  call(state.self, 0);
  console.log(state.lines.join(" | "));
}
