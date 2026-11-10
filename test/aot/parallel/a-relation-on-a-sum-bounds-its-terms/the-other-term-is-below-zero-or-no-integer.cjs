function stepsBelow(from, limit) {
  let count = 0;
  while (from + count < limit) count++;
  return count;
}
function stepsUpTo(from, limit) {
  let count = 0;
  while (from + count <= limit) count++;
  return count;
}
function stepsTurnedRound(from, limit) {
  let count = 0;
  while (limit > count + from) count++;
  return count;
}
function stepsLeftByBreak(from, limit) {
  let count = 0;
  for (;;) {
    if (from + count >= limit) break;
    if (count > 40) return "never";
    count++;
  }
  return count;
}
function twiceTheTerm(limit) {
  let count = 0;
  while (count + count < limit) count++;
  return count;
}
function read(list, from, limit) {
  let seen = "";
  let count = 0;
  while (from + count < limit) { seen += list[count] + "|"; count++; }
  return seen;
}
globalThis.kept = [stepsBelow, stepsUpTo, stepsTurnedRound, stepsLeftByBreak, twiceTheTerm, read];
const said = [];
for (const [from, limit] of [[0, 5], [-7, 5], [-2147483648, -2147483640], [3, 3], [9, 2], [-0, 2], [0.5, 4], [-1.5, 3.25], [2, 4.5], [NaN, 3], [1, NaN], [-Infinity, NaN], [Infinity, 3], ["2", 6], [1, "4"], [null, 3], [undefined, 3], [true, 4]])
  said.push([stepsBelow(from, limit), stepsUpTo(from, limit), stepsTurnedRound(from, limit), stepsLeftByBreak(from, limit)].join());
console.log(said.join(" "));
console.log(twiceTheTerm(9), twiceTheTerm(0), twiceTheTerm(-4), twiceTheTerm(7.5));
console.log(read([10, 20, 30], -2, 3), read([10, 20, 30], 1, 3), read("abc", -1, 1), read([1], 0, 0) + ".");
