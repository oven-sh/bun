// A loop calls function objects of one function that are kept in fields, one of them twice a turn. Between those two calls a function that the loop calls gives it a displayName, through a value that came back
// out of code made at run time. Prints what the frames call them, wherever that changes from turn to turn.
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
function makeHolder(k) {
  return { k, run: makeStep(k) };
}
function rename(holder, name) {
  handedBack(holder.run).displayName = name;
}
const holders = [makeHolder(3), makeHolder(4)];
console.log(
  changes(3000, i => {
    const before = holders[0].run();
    if (i === 1700) rename(holders[0], "displayedThird");
    return before + "," + holders[0].run() + "," + holders[1].run();
  }),
);
