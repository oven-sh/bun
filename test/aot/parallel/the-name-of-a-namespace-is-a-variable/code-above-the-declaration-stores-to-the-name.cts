// `namespace Box {}` is `var Box; (function (Box) {})(Box || (Box = {}))` in what runs: the block adds to the object that the name holds by then. So does an enum.
// @ts-ignore
Box = { size: "early" };
namespace Box {
  export var depth = 1;
  export function peek() { return depth; }
}
// @ts-ignore
Level = { Old: "early" };
enum Level { Low, High = "high" }
console.log(JSON.stringify(Box), Box.peek(), JSON.stringify(Level));
