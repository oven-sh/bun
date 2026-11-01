// Each loop runs fast until one turn takes a seldom-taken path that changes what the loop relies on, then goes on.
function appendAll(from, first) {
  const list = [first];
  for (let k = 0; k < from.length; k++) list.push(from[k]);
  return list.length * 1000 + list[list.length - 1];
}

function readWhileTheListGrows(list, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const value = list[i & 7];
    sum = (sum + (value === undefined ? list.push(i) : value)) | 0;
  }
  return sum;
}

function readWhileTheListGetsAFraction(list, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const value = list[i & 15];
    sum += value === undefined ? list.push(i + 0.5) : value;
  }
  return sum;
}

function readWhileTheListGetsAText(list, turns) {
  let sum = "";
  for (let i = 0; i < turns; i++) {
    const value = list[i % 6];
    sum = String(sum.length + (value === undefined ? list.push("t" + i) : value)).slice(-6);
  }
  return sum;
}

function copyWhileTheSourceGrows(from, turns) {
  const list = [];
  for (let k = 0; k < from.length && k < turns; k++) {
    if (k % 5 === 4) from.push(k);
    list.push(from[k]);
  }
  return list.join();
}

function copyWhileTheSourceShrinks(from) {
  const list = [0];
  for (let k = 0; k < from.length; k++) {
    if (from[k] === 7) from.length = 9;
    list.push(from[k]);
  }
  return list.join();
}

function growInTwoTurnsInARow(list, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const value = list[i % 40];
    sum = (sum + (value === undefined ? list.push(i, i, i) : value)) | 0;
  }
  return sum + list.length;
}

function walkWhileItGrows(list) {
  let sum = 0;
  for (let k = 0; k < list.length; k++) {
    const value = list[k];
    if (value === 0 && list.length < 64) list.push(k, k + 1, 0);
    sum = (sum + value) | 0;
  }
  return sum * 100 + list.length;
}

function growsNow(list, k) {
  if (k % 7 === 6 && list.length < 40) list.push(k, k, k, k, k, k, k, k, k);
  return true;
}
function walkWhileItsTestGrowsIt(list) {
  const seen = [];
  for (let k = 0; k < list.length && growsNow(list, k); k++) seen.push(list[k]);
  return seen.join();
}

const shared = [4, 5, 6];
function appendShared(first, turn) {
  const list = [first];
  for (let k = 0; k < shared.length; k++) {
    list.push(shared[k]);
    if (turn === 15000 && k === 1) shared.push(7, 8, 9, 10, 11, 12, 13, 14, 15);
  }
  return list.length * 100 + list[list.length - 1];
}

let check = 0;
for (let i = 0; i < 20000; i++) check = (check + appendAll([4, 5, 6, i], i & 7)) | 0;
console.log("append", check, appendAll([], 1), appendAll([1.5], 2), appendAll(["x"], 3));
for (const start of [0, 1, 7, 8]) {
  const list = Array.from({ length: start }, (_, k) => k + 1);
  console.log("grows", start, readWhileTheListGrows(list, 30000), list.length, list.join());
}
for (const start of [0, 3, 15, 16]) {
  const list = Array.from({ length: start }, (_, k) => k + 1);
  console.log("fraction", start, readWhileTheListGetsAFraction(list, 30000), list.join());
}
for (const start of [0, 5, 6]) {
  const list = Array.from({ length: start }, (_, k) => k + 1);
  console.log("text", start, readWhileTheListGetsAText(list, 30000), list.join());
}
for (let i = 0; i < 3000; i++) check = (check + copyWhileTheSourceGrows([1, 2, 3, 4, 5, 6], 40).length) | 0;
console.log("source grows", check, copyWhileTheSourceGrows([1, 2, 3, 4, 5, 6], 40));
for (let i = 0; i < 3000; i++) check = (check + copyWhileTheSourceShrinks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).length) | 0;
console.log("source shrinks", check, copyWhileTheSourceShrinks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
console.log("two in a row", growInTwoTurnsInARow([], 50000), growInTwoTurnsInARow([1, 2, 3], 50000));
for (let i = 0; i < 3000; i++) check = (check + walkWhileItGrows([1, 0, 2, 3])) | 0;
console.log("walked while it grows", check, walkWhileItGrows([1, 0, 2, 3]), walkWhileItGrows([]), walkWhileItGrows([0]));
for (let i = 0; i < 3000; i++) check = (check + walkWhileItsTestGrowsIt([1, 2, 3, 4, 5, 6, 7, 8]).length) | 0;
console.log("its test grows it", check, walkWhileItsTestGrowsIt([1, 2, 3, 4, 5, 6, 7, 8]));
for (let i = 0; i < 30000; i++) check = (check + appendShared(i & 7, i)) | 0;
console.log("shared", check, shared.join(), appendShared(1, 0));
