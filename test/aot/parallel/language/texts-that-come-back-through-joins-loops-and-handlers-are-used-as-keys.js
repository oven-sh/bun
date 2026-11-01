// A function returns one of several texts, which meet in joins, go round loops and come out of handlers, and the caller uses what comes back as a key.
const table = { zero: 0, one: 1, two: 2, three: 3, caught: 4, last: 5, made1: 6, made2: 7, "": 8 };
const n = process.argv.length > 99 ? 7 : 2;
function byBranches(n) {
  let picked = "zero";
  if (n > 0) picked = "one";
  if (n > 1) picked = "two";
  if (n > 2) picked = "three";
  return picked;
}
function byLoop(n) {
  let picked = "zero";
  for (let i = 0; i < n; i++) picked = i & 1 ? "one" : "two";
  return picked;
}
function byHandler(n) {
  let picked = "zero";
  try {
    if (n > 1) throw new Error("thrown");
    picked = "one";
  } catch {
    picked = "caught";
  } finally {
    if (n > 5) picked = "last";
  }
  return picked;
}
function bySwitch(n) {
  let picked;
  switch (n) {
    case 0: picked = "zero"; break;
    case 1: picked = "one"; break;
    case 2: picked = "two"; break;
    default: picked = "three";
  }
  return picked;
}
function made(n) {
  let picked = "";
  if (n > 0) picked = "made" + (n > 1 ? 2 : 1);
  return picked;
}
const handedOn = n => (n > 1 ? byBranches(n - 1) : byLoop(n + 1));
function twoReturns(n) {
  let picked = "one";
  if (n & 1) return picked;
  picked = n > 1 ? "two" : "zero";
  return picked;
}
const lines = [];
for (const pick of [byBranches, byLoop, byHandler, bySwitch, made, handedOn, twoReturns]) {
  for (const given of [0, 1, n, 3, 6]) {
    const key = pick(given);
    lines.push(pick.name + " " + given + " " + key + " " + table[key] + " " + (key in table) + " " + Object.hasOwn(table, key));
  }
}
console.log(lines.join("\n"));
