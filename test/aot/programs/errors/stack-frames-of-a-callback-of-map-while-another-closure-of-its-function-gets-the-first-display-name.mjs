// Each line: the name in the first frame of the callback of map(), one round before and the rounds after another closure of the same function got the first displayName of the process. The stored output lists the callback under the new name until map() ends.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function make(other) {
  return function made(round) {
    if (round === 1) handedBack(other()).displayName = "displayed";
    return new Error("x").stack;
  };
}
const list = [];
list.push(
  make(() => list[1]),
  make(() => list[0]),
);
console.log("map |", [0, 1, 2, 3].map(handedBack(list[0])).map(firstFrame).join(" | "));
console.log("then |", firstFrame(handedBack(list[0])(0)), "|", firstFrame(handedBack(list[1])(0)));
