// Loops whose counter is compared with a bound, and whose unlikely paths count on by themselves, with bounds and starts on both sides of 2 ** 31 and 2 ** 53.
function plain(from, to) {
  let sum = 0;
  for (let i = from; i < to; i++)
    sum = sum + (i & 7) | 0;
  return sum;
}
function list() {
  return [].slice.call(arguments);
}
function throughArguments(from, to) {
  let sum = 0, last = 0;
  for (let i = from; i < to; i++) {
    const r = list(i & 7, 2, 3);
    sum = sum + r.length + r[0] | 0;
    last = i;
  }
  return sum + ":" + last;
}
function skips(from, to, odd) {
  let turns = 0, last = 0;
  for (let i = from; i < to; i++) {
    if (odd[i & 3] === "skip")
      i++;
    turns++;
    last = i;
  }
  return turns + ":" + last;
}
function doubles(to) {
  let turns = 0, x = 1;
  for (; x < to; x *= 2)
    turns++;
  return turns + ":" + x;
}
function mirrors(to) {
  let turns = 0, x = 0;
  for (; x < to && turns < 9; x = 2 - x)
    turns++;
  return turns + ":" + x;
}
function down(from, to) {
  let sum = 0, last = 0;
  for (let i = from; i > to; i--) {
    sum = sum + (i & 3) | 0;
    last = i;
  }
  return sum + ":" + last;
}
const odd = ["go", "go", "skip", "go"];
const edges = [0, 2 ** 31 - 12, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 6, 2 ** 53 - 40];
for (let round = 0; round < 3; round++) {
  for (const edge of edges) {
    for (const length of [0, 1, 9, 20.5]) {
      console.log(edge, length, plain(edge, edge + length), throughArguments(edge, edge + length), skips(edge, edge + length, odd), down(-edge, -edge - length), down(edge + length, edge));
    }
  }
  console.log(plain(0, 200000), throughArguments(0, 200000), skips(0, 200000, odd), down(200000, 0));
  for (const to of [0, 1, 100, 2 ** 31 - 1, 2 ** 31, 2 ** 40, 2 ** 60, Infinity === round ? 0 : 2 ** 62, NaN, -5, 0.5])
    console.log(to, doubles(to), mirrors(to));
}
console.log(plain(0.5, 4), plain(-3, 3), plain(NaN, 3), plain(0, NaN), plain("2", "6"), skips(-2147483650, -2147483640, odd));
