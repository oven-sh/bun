const at = JSON.parse("0");
const held = [];
function lay(value) {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = value;
}
function fill(holders, value) {
  held[0] = holders[0];
  lay(value);
  return holders[0];
}
const said = [];
for (const value of [7, 1.5, "x", undefined, null, -0, NaN, { a: 1 }, 2 ** 31, 10n]) {
  for (const made of [[1, 2, 3], [1.5, 2.5], ["a", {}], [], [, , 3], new Array(3), [1, , 2.5, "z"]]) {
    const filled = fill([made], value);
    said.push(`${filled.length} ${filled.map(each => (Object.is(each, -0) ? "-0" : typeof each === "object" ? JSON.stringify(each) : String(each))).join()}`);
  }
}
said.push(fill([new Int16Array(3)], "12").join());
console.log(
  said.join(`
`),
);
