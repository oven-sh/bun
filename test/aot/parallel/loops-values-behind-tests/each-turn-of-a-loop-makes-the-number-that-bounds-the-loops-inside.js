// `for (let n = next(); n > 0; n = next())` around `for (let i = 0; i < n; i++)`, which holds a loop of its own or none. The bounds come off a list: int32s, then fractions,
// numbers beyond int32 and NaN among them, so a run goes from the loop for an int32 to the one for any number and back.
function take(list) {
  return list.shift() ?? 0;
}
function bitsBelow(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let rest = (i & 1023) + 1;
    while (rest > 1) {
      rest >>= 1;
      sum++;
    }
    if (i === 40) return sum + 0.5;
  }
  return sum;
}
function xorBelow(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum ^= i;
    if (i === 50) return -sum;
  }
  return sum;
}
function runsOf(bounds, each) {
  const list = bounds.slice();
  let answer = 0;
  let turns = 0;
  for (let n = take(list); n > 0; n = take(list)) {
    answer = (answer * 31 + each(n) * 2) % 1000003;
    turns++;
  }
  return answer + ":" + turns + ":" + list.length;
}
const lists = [
  [3, 7, 12, 1, 30],
  [3, 2.5, 7, 0.25, 12, 6.000001, 1],
  [5, 2147483647, 4, 2147483648, 3, 4294967297.5, 2, Infinity, 1, 1e21],
  [9, NaN, 8],
  [9, -0, 8],
  [9, -3, 8],
  [0.5],
  [],
  [4, undefined, 6],
  [4, null, 6],
];
let answers = "";
for (let turn = 0; turn < 3000; turn++) {
  answers = "";
  for (const bounds of lists) answers += runsOf(bounds, bitsBelow) + " " + runsOf(bounds, xorBelow) + "\n";
}
console.log(answers);
