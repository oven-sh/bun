// Every call goes to a function object that was made for it and that nothing else holds. Each has a name of its own, which its stack frame shows however deep the frame lies and however many collections have run since the call.
let returns = 0;
const make = name =>
  Object.defineProperty(
    function (depth, atTheBottom) {
      const answer = depth ? descend(depth - 1, atTheBottom) : atTheBottom();
      returns++;
      return answer;
    },
    "name",
    { value: name },
  );
function descend(depth, atTheBottom) {
  const answer = make("depth" + depth)(depth, atTheBottom);
  returns++;
  return answer;
}
function padded(depth, atTheBottom, a, b, c, d, e, f, g, h) {
  const answer = descend(depth, atTheBottom);
  return [answer, a, b, c, d, e, f, g, h][0];
}
function namesInFrames() {
  const names = new Error("x").stack
    .split("\n")
    .map(line => line.trim().split(" ")[1])
    .filter(name => name.startsWith("depth"));
  const inOrder = names.every((name, index) => name === "depth" + index);
  return names.length + (inOrder ? " in order" : " " + names.join());
}
Error.stackTraceLimit = Infinity;
for (const depth of [0, 1, 7, 40, 333, 1500, 12, 900, 2]) {
  const look = () => {
    const before = namesInFrames();
    Bun.gc(true);
    const between = namesInFrames();
    // Calls from further in than these frames come and go, with a collection while they run.
    const inner = padded(depth % 50, () => (Bun.gc(true), namesInFrames()), 1, 2, 3, 4, 5, 6, 7, 8);
    Bun.gc(true);
    return [before, between, inner, namesInFrames()].join(" | ");
  };
  console.log(depth, descend(depth, look));
  console.log(depth, padded(depth, look, 1, 2, 3, 4, 5, 6, 7, 8));
}
console.log(returns);
