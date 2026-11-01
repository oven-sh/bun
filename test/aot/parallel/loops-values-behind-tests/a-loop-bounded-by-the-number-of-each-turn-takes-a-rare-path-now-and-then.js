function take(list) {
  return list.shift() ?? 0;
}
const seen = [];
function note(value) {
  seen.push(typeof value === "object" ? value.a + ":" + value.b : value);
  if (typeof value === "object") value.a = -value.a;
}
function sortedEnds(n) {
  let sum = 0;
  for (let i = 0; i < n && i < 60; i++) {
    const list = [];
    let seed = i | 1;
    for (let k = 0; k < 8; k++) list.push((seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 1023);
    if (i === 37) delete list[7];
    list.sort((a, b) => a - b);
    sum = (sum + list[0] + (list[7] ?? -5)) | 0;
  }
  return sum;
}
function xorWithCalls(n) {
  let sum = 0;
  for (let i = 0; i < n && i < 90; i++) {
    sum ^= i * 3;
    if (sum === 44) note(sum + i);
  }
  return sum;
}
function pairs(n) {
  let sum = 0;
  for (let i = 0; i < n && i < 70; i++) {
    const pair = { a: i, b: sum };
    if ((i & 31) === 19) note(pair);
    sum = (sum + pair.a * 2 + (pair.b & 3)) | 0;
  }
  return sum;
}
function runsOf(bounds, each) {
  const list = bounds.slice();
  let answer = 0;
  let turns = 0;
  for (let n = take(list); n > 0; n = take(list)) {
    answer = (answer * 31 + each(n)) % 1000003;
    turns++;
  }
  return answer + ":" + turns + ":" + list.length;
}
const lists = [
  [3, 7, 40, 1, 64],
  [50, 2.5, 38.5, 0.25, 100, 20.000001, 1],
  [45, 2147483647, 4, 2147483648, 21, 4294967297.5, 2, Infinity, 1, 1e21],
  [39, NaN, 8],
  [39, -0, 8],
  [0.5],
  [],
  [25, undefined, 6],
];
let answers = "";
for (let turn = 0; turn < 1500; turn++) {
  answers = "";
  seen.length = 0;
  for (const bounds of lists) answers += runsOf(bounds, sortedEnds) + " " + runsOf(bounds, xorWithCalls) + " " + runsOf(bounds, pairs) + "\n";
}
console.log(answers + seen.length + " " + seen.slice(0, 12).join(" "));
