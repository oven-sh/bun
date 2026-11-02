function smallestAsText(i) {
  return [10, 9, 1, i & 7, 100, 25].sort()[0];
}
function smallestAndLargest(i) {
  const list = [5, 3, i & 7, 9, 1, 7, 2, 8];
  list.sort((a, b) => a - b);
  return list[0] + list[7] * 10;
}
function largestFirst(i) {
  const list = [5, 3, i & 7, 9, 1, 7, 2, 8];
  list.sort((a, b) => b - a);
  return list.join("");
}
function turnedRound(i) {
  const list = [1, 2, 3, i & 7];
  list.reverse();
  return list[0] * 1000 + list[3];
}
let sum = 0;
let text = "";
for (let i = 0; i < 40; i++) {
  sum += smallestAsText(i) + smallestAndLargest(i) + turnedRound(i);
  text = largestFirst(i);
}
console.log(sum, text);

function limits() {
  const list = [2147483647, -2147483648, 0, -1, 1, 2147483646, -2147483647];
  list.sort((a, b) => a - b);
  const up = list.join();
  list.sort((a, b) => b - a);
  return up + " " + list.join();
}
console.log(limits());

function pastInt32() {
  const list = [3, 4294967296, -4294967297, 1];
  list.sort((a, b) => a - b);
  list.reverse();
  return list.join();
}
console.log(pastInt32());

function withFractionsNaNAndZeroes() {
  const list = [1.5, -0, 0, NaN, -1.5, 3];
  list.sort((a, b) => a - b);
  return list.map(value => (Object.is(value, -0) ? "-0" : String(value))).join();
}
console.log(withFractionsNaNAndZeroes());

function withHolesAndUndefined() {
  const list = [3, , 1, undefined, 2];
  list.sort((a, b) => a - b);
  const sorted = list.map(String).join() + " " + list.length + " " + (3 in list) + " " + (4 in list);
  list.reverse();
  return sorted + " " + (0 in list) + " " + (1 in list) + " " + String(list[2]);
}
console.log(withHolesAndUndefined());

function comparatorThatChangesTheList() {
  const list = [4, 3, 2, 1];
  let calls = 0;
  list.sort((a, b) => {
    if (calls++ === 0) list.push("later");
    return a - b;
  });
  return list.length + " " + typeof list[list.length - 1];
}
console.log(comparatorThatChangesTheList());

function frozen() {
  const list = Object.freeze([3, 1, 2]);
  try {
    list.sort((a, b) => a - b);
  } catch (error) {
    return error instanceof TypeError ? "TypeError " + list.join() : "other";
  }
  return "sorted " + list.join();
}
console.log(frozen());

function storedIntoBehindTheSort(i) {
  const list = [3, 1, 2];
  list.sort();
  list[1] = i + 0.5;
  list.reverse();
  list.push("end");
  return list.join();
}
console.log(storedIntoBehindTheSort(1));

function long() {
  const list = [];
  for (let i = 0; i < 100; i++) list.push((i * 37) % 101);
  list.sort((a, b) => a - b);
  let isInOrder = true;
  for (let i = 1; i < list.length; i++) if (list[i - 1] > list[i]) isInOrder = false;
  return isInOrder + " " + list[0] + " " + list[99];
}
console.log(long());
