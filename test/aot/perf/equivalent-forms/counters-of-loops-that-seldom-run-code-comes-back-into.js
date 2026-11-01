const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

function same(i) {
  return i;
}
function lent(i) {
  box.step = same;
  return -i;
}
function Box() {
  this.step = same;
}
Box.prototype.step = lent;
const box = new Box();

function calledByName(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + same(i)) | 0;
  return sum;
}
function fromZero(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + box.step(i)) | 0;
  return sum;
}
function fromBelowTheLastInt32(n) {
  let sum = 0;
  for (let i = 2147483640; i < n; i++) sum = (sum + box.step(i)) | 0;
  return sum;
}
function withoutTheMember(loop, n) {
  delete box.step;
  return loop(n);
}

function deletes(i) {
  if (i % 3 === 2) delete turns.step;
  return i;
}
function stores(i) {
  turns.step = deletes;
  return 1000 + i;
}
function Turns() {
  this.step = deletes;
}
Turns.prototype.step = stores;
const turns = new Turns();
function everyThirdTurnDeletes(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turns.step(i)) | 0;
  return sum;
}
function everyThirdTurnDeletesBelowTheLastInt32(n) {
  let sum = 0;
  for (let i = 2147483640; i < n; i++) sum = (sum + turns.step(i)) | 0;
  return sum;
}

const loops = {
  "a function called by its name": calledByName,
  "a function read out of a member that is deleted now and then": fromZero,
};

if (which) console.log(which, loops[which](rounds));
else {
  for (const n of [rounds, 3, 2.5, 1, 0, -1, NaN]) console.log("from zero", n, fromZero(n), withoutTheMember(fromZero, n));
  for (const n of [2147483639, 2147483640, 2147483641, 2147483646.5, 2147483647, 2147483648, 2147483653, 2147483660.25])
    console.log("from below the last int32", n, fromBelowTheLastInt32(n), withoutTheMember(fromBelowTheLastInt32, n));
  for (const n of [rounds, 10, 3.5, 0]) console.log("every third turn deletes the member", n, everyThirdTurnDeletes(n), Object.keys(turns).length);
  for (const n of [2147483641, 2147483647, 2147483648, 2147483660.25]) console.log("every third turn deletes the member, below the last int32", n, everyThirdTurnDeletesBelowTheLastInt32(n), Object.keys(turns).length);
}
