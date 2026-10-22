// The loop's counter is an int32 that is wanted as a number far more often than as an integer, so it is kept as a double. The literals that take it hold int32s alone:
// the build checks itself while it runs, and stops where one of them is created with another storage than its type says.
function half(value) {
  return value / 2;
}
function total(list, depth) {
  if (depth > 0) return total(list, depth - 1);
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function grows(list, depth, more) {
  if (depth > 0) return grows(list, depth - 1, more);
  list[list.length] = more;
  list[0] = more;
  list.push(more);
  return list.join("+");
}
const lines = [];
for (let round = 0; round < 3; round++) {
  lines.push(half(-round), half(0.5), half(round), half(round), half(round), half(round), half(round), half(round), half(round), half(round), half(round), half(round), half(round), half(round));
  lines.push(total([round], 2), total([round, round + 1], 2), total([7, round, 9, round], 2), grows([round], 2, round), grows([1, 2], 2, round));
}
console.log(lines.join(" "));
