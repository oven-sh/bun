// Two functions read under a key. One of them runs.
// STATISTIC: FunctionsLowered >= 300
function pickNever(from, key) {
  return from[key];
}
function pick(from, key) {
  return from[key];
}
const name = ["find", "Last"].join("");
console.log(String(pick([1, 2, 3, 4], name).call([1, 2, 3, 4], value => value % 2 === 1)));
