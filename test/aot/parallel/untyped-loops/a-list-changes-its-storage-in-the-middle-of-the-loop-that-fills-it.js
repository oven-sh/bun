// A loop stores into or reads from a list whose storage is replaced on some turn: by growing, by another kind of element, by a new length, by a callee.
function describe(list) {
  let text = list.length + ":";
  for (let k = 0; k < list.length; k += 1 + (list.length >> 3)) text += " " + k + "=" + list[k];
  return text;
}
function growsPastItsRoom(seed, count) {
  const list = new Array();
  for (let k = 0; k < count; k++) list[k] = (seed + k * 40503) | 0;
  return list;
}
function takesAFraction(seed, at) {
  const list = new Array();
  for (let k = 0; k < 40; k++) list[k] = k === at ? seed + 0.5 : (seed + k) | 0;
  return list;
}
function takesAText(seed, at) {
  const list = new Array();
  for (let k = 0; k < 40; k++) list[k] = k === at ? "text" + seed : (seed + k) | 0;
  return list;
}
function leavesGaps(seed, step) {
  const list = new Array();
  for (let k = 0; k < 16; k++) list[k * step] = (seed + k) | 0;
  return list;
}
function isCutShort(seed, at) {
  const list = new Array();
  for (let k = 0; k < 64; k++) {
    if (k === at) list.length = 3;
    list[k] = (seed + k) | 0;
  }
  return list;
}
function lengthen(list, by) {
  for (let k = 0; k < by; k++) list.push(-k);
}
function isLengthenedByACallee(seed, every) {
  const list = new Array();
  for (let k = 0; k < 64; k++) {
    if (k % every === every - 1) lengthen(list, 50);
    list[k] = (seed + k) | 0;
  }
  return list;
}
function isReadWhileItGrows(list, every) {
  let sum = 0;
  for (let k = 0; k < list.length && k < 500; k++) {
    if (k % every === every - 1) lengthen(list, 9);
    sum = (sum + list[k]) | 0;
  }
  return sum;
}
function copies(from, to, count) {
  for (let k = 0; k < count; k++) to[k + 1] = from[k];
  return to;
}
class Holder {
  list = new Array();
  fill(seed, count) {
    const list = this.list;
    for (let k = 0; k < count; k++) list[k] = (seed + k * 3) | 0;
    return this;
  }
}
for (const seed of [1, -7, 2147483640]) {
  console.log(describe(growsPastItsRoom(seed, 16)));
  console.log(describe(growsPastItsRoom(seed, 17)));
  console.log(describe(growsPastItsRoom(seed, 1000)));
  for (const at of [0, 1, 15, 16, 17, 39]) console.log(describe(takesAFraction(seed, at)), describe(takesAText(seed, at)), describe(isCutShort(seed, at)));
  for (const step of [1, 2, 7, 1000, 100000]) console.log(describe(leavesGaps(seed, step)));
  for (const every of [1, 2, 5, 63]) console.log(describe(isLengthenedByACallee(seed, every)), isReadWhileItGrows(growsPastItsRoom(seed, 20), every));
  const same = growsPastItsRoom(seed, 8);
  console.log(describe(copies(same, same, 40)), describe(copies(growsPastItsRoom(seed, 40), new Array(), 40)));
  console.log(describe(new Holder().fill(seed, 5).fill(seed + 1, 300).list));
}
const atTopLevel = new Array();
for (let k = 0; k < 300; k++) atTopLevel[k] = k === 200 ? 0.25 : k;
console.log(describe(atTopLevel));
const frozen = Object.freeze(growsPastItsRoom(4, 4));
try {
  "use strict";
  copies(growsPastItsRoom(9, 8), frozen, 8);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(describe(frozen));
