const whole = Array.from({ length: 64 }, (_, k) => k);
const mixed = Array.from({ length: 64 }, (_, k) => k + 0.5);
const odd = [1.5, NaN, -0, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, Infinity, -Infinity, 4294967295.75, 1e300, -1e-300, 7];

function addOuterCounter(list, i) {
  for (let k = 0; k < list.length; k++) list[k] = (list[k] + i) & 1023;
  return list[i & 63];
}
function addOwnCounter(list) {
  for (let k = 0; k < list.length; k++) list[k] = (list[k] + k) & 1023;
  return list[5];
}
function runningSum(list, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + list[i % list.length]) | 0;
  return sum;
}
function runningSumBesideCounter(list, turns) {
  let sum = 0;
  let other = 0;
  for (let i = 0; i < turns; i++) {
    sum = (sum + list[i % list.length]) | 0;
    other = (other ^ ((list[i % list.length] + i) | 0)) | 0;
  }
  return sum + " " + other;
}
function sumInInnerLoop(list, rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) for (let k = 0; k < list.length; k++) sum = (sum + list[k] + round) | 0;
  return sum;
}

let answer = 0;
for (let i = 0; i < 3000; i++) answer = (answer + addOuterCounter(whole, i)) | 0;
console.log(answer, whole.slice(0, 8).join(" "));
answer = 0;
for (let i = 0; i < 3000; i++) answer = (answer + addOuterCounter(mixed, i)) | 0;
console.log(answer, mixed.slice(0, 8).join(" "));
for (let i = 0; i < 300; i++) answer = (answer + addOwnCounter(whole)) | 0;
console.log(answer, whole.slice(0, 8).join(" "));

for (const list of [whole, Array.from({ length: 64 }, (_, k) => k + 0.25), odd]) {
  console.log(runningSum(list, 20000), runningSumBesideCounter(list, 20000), sumInInnerLoop(list, 400));
}
for (let i = 0; i < 40; i++) {
  const copy = odd.slice();
  addOuterCounter(copy, i * 1000003);
  if (i % 13 === 0) console.log(copy.join(" "));
}
const holey = [1, 2, , 4.5];
console.log(runningSum(holey, 1000), addOuterCounter(holey, 3), holey.join(" "));

const bytes = new Uint8Array(16);
const words = new Int32Array(8);
function fill(i) {
  for (let k = 0; k < bytes.length; k++) bytes[k] = i + k;
  for (let k = 0; k < words.length; k++) words[k] = i - k;
  return bytes[15] + words[7];
}
let filled = 0;
for (let i = 0; i < 20000; i++) filled = (filled + fill(i)) | 0;
console.log(filled, bytes.join(" "), words.join(" "));
for (const i of [0.5, -0.5, NaN, -0, 2 ** 31, 2 ** 31 - 4, -(2 ** 31) - 3, 2 ** 32 + 7, 2 ** 53, 1e300, Infinity, -Infinity, 255.999]) {
  console.log(i, fill(i), bytes.join(" "), words.join(" "));
}
function fillFromCounterThatIsANumber(n) {
  let sum = 0;
  for (let i = 0.25; i < n; i += 0.25) sum = (sum + fill(i)) | 0;
  return sum;
}
console.log(fillFromCounterThatIsANumber(500));
