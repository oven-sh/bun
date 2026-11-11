// Every property of a table is a getter, and the getters are function objects of one function. A loop reads them many times through small functions. In the middle of it one getter is given a displayName through a
// value that came back out of code made at run time. Prints what the frames call them, wherever that changes from turn to turn.
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
function makeGetter(k) {
  return () => nameInFrame() + k;
}
function makeTable() {
  const table = {};
  for (const key of ["alpha", "beta"]) Object.defineProperty(table, key, { get: makeGetter(key), enumerable: true, configurable: true });
  return table;
}
const table = makeTable();
handedBack(table);
const readAlpha = () => table.alpha;
const readBeta = () => table.beta;
console.log(
  changes(3000, i => {
    if (i === 1900) handedBack(Object.getOwnPropertyDescriptor(table, "alpha").get).displayName = "displayedAlpha";
    return readAlpha() + "," + readBeta();
  }),
);
