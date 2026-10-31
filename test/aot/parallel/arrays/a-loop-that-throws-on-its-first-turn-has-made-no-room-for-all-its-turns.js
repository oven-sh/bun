// A number from outside says how many elements a loop is to push, and what the loop calls throws on the first turn. Room for all the turns is made in front of a loop only where every turn comes.
const limit = Number(process.argv[3] ?? 0);
function checked(i, depth = 2) {
  if (depth > 0) return checked(i, depth - 1);
  if (i >= limit) throw new RangeError("stop at " + i);
  return i;
}
function fill(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(checked(i));
  return list;
}
const n = Number(process.argv[2] ?? 67108864) | 0;
const before = process.memoryUsage().rss;
let said = "";
try {
  said = "filled " + fill(n).length;
} catch (error) {
  said = "threw: " + error.message;
}
const grownBy = (process.memoryUsage().rss - before) / 1048576;
console.log(said, grownBy < 100 ? "| the process grew by little" : "| the process grew by much");
