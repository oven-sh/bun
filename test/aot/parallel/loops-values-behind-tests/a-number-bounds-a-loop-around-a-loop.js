// `for (let i = 0; i < n; i++)` around another loop, where n is any number: an int32, a fraction, NaN, an infinity, -0, a number beyond int32.
function sumOfSums(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) sum = (sum + ((i + k * 40503) | 0)) | 0;
  }
  return sum;
}
function upToAndWith(n) {
  let sum = 0;
  let last = -1;
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k < 3; k++) sum = (sum ^ (i << k)) | 0;
    last = i;
  }
  return sum + ":" + last;
}
function down(n) {
  let sum = 0;
  for (let i = 5; i > n; i--) {
    for (let k = 0; k < 3; k++) sum = (sum + i * k) | 0;
    if (i < -20) return sum + ":left";
  }
  return sum;
}
function leavesEarly(n) {
  let turns = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1000) {
    for (let k = 0; k < 2; k++) sum = (sum + (i & 255) + k) | 0;
    if (++turns === 6) return sum + ":" + i;
  }
  return sum + ":end";
}
function startsNearTheEndOfInt32(n) {
  let sum = 0;
  let last = 0;
  for (let i = 2147483640; i < n; i++) {
    for (let k = 0; k < 2; k++) sum = (sum + (i | 0) + k) | 0;
    last = i;
  }
  return sum + ":" + last;
}
function fillsLists(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const list = [];
    for (let k = 0; k < 5; k++) list[k] = (i + k * 7) | 0;
    for (let k = 0; k < 5; k++) sum = (sum + list[k]) | 0;
  }
  return sum;
}
function boundChangesInTheLoop(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) sum = (sum + (i | 0)) | 0;
    if (i === 2) n -= 1.5;
  }
  return sum + ":" + n;
}
const bounds = [0, 1, 7, 2.5, 6.000001, -3, -0, NaN, 0.1, 2147483647 - 2147483640, -Infinity];
const far = [Infinity, 2147483647, 2147483648, 2147483650.5, 4294967296, 1e21];
let answers = "";
for (let turn = 0; turn < 2000; turn++) {
  answers = "";
  for (const n of bounds)
    answers += sumOfSums(n) + " " + upToAndWith(n) + " " + down(n) + " " + leavesEarly(n) + " " + fillsLists(n) + " " + boundChangesInTheLoop(n) + "\n";
  for (const n of far) answers += leavesEarly(n) + " " + startsNearTheEndOfInt32(Math.min(n, 2147483655.5)) + "\n";
}
console.log(answers);
