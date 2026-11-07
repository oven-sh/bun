// Flags: --aot-limit=MaxWarmCodeValues:1
// A function whose function objects are renamed records the object it is entered with, and a stack trace names each frame by that object. Code that is not warm records by a call.
function make(next) {
  return function step(depth, a, b, c, d, e) {
    if (!depth) throw new Error("at the bottom");
    return steps[next](depth - 1, a, b, c, d, e) + 1;
  };
}
const steps = [make(1), make(2), make(0)];
Object.defineProperty(steps[0], "name", { value: "first" });
Object.defineProperty(steps[1], "name", { value: "second" });
function namesOfFrames(error) {
  return error.stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().split(" ")[1])
    .filter(name => name === "first" || name === "second" || name === "step")
    .join(" ");
}
for (const [start, depth] of [
  [0, 0],
  [0, 4],
  [1, 5],
  [2, 7],
]) {
  try {
    steps[start](depth, 1, 2, 3, 4, 5);
  } catch (error) {
    console.log(start, depth, namesOfFrames(error));
  }
}
// The same functions entered from frames of different depths, so that records of calls that have returned lie in the way.
function deeper(levels, start) {
  return levels ? deeper(levels - 1, start) + 1 : steps[start](2);
}
for (let levels = 0; levels < 6; levels++) {
  try {
    deeper(levels, levels % 3);
  } catch (error) {
    console.log(levels, namesOfFrames(error));
  }
}
function link(next) {
  return function hop(value) {
    if (!next) throw new Error("at the end");
    return next(value) + 1;
  };
}
const last = link(null);
const middle = link(last);
const head = link(middle);
Object.defineProperty(head, "name", { value: "first" });
Object.defineProperty(last, "name", { value: "second" });
try {
  head(1);
} catch (error) {
  console.log(
    error.stack
      .split("\n")
      .slice(1, 4)
      .map(line => line.trim().split(" ")[1])
      .join(" "),
  );
}
