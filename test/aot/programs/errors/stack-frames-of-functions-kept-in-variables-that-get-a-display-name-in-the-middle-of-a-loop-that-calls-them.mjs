// A loop calls two function objects of one function many times. In the middle of it first one, then the other is given a displayName through a value that came back out of code made at run time.
// Prints what the frames call them, wherever that changes from turn to turn.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function nameInFrame() {
  return new Error("x").stack.split("\n")[2].trim().split(" ")[1];
}
function changes(turns, turn) {
  const lines = [];
  let last = "";
  for (let i = 0; i < turns; i++) {
    const now = turn(i);
    if (now !== last) lines.push(i + ":" + now);
    last = now;
  }
  return lines.join(" ");
}
function makeStep(k) {
  return function step() {
    return nameInFrame() + k;
  };
}
const first = makeStep(1);
const second = makeStep(2);
console.log(
  changes(3000, i => {
    if (i === 1500) handedBack(first).displayName = "displayedFirst";
    if (i === 2500) handedBack(second).displayName = "displayedSecond";
    return first() + "," + second();
  }),
);
