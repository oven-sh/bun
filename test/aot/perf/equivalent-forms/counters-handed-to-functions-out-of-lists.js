const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

function same(i) {
  return i;
}
function twice(i) {
  return i * 2;
}
const first = [same];
const second = [twice];

function calledByName(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + same(i)) | 0;
  return sum;
}
function readOutOfList(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + first[0](i)) | 0;
  return sum;
}

function twoCalledByName(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + same(i) + twice(i)) | 0;
  return sum;
}
function twoReadOutOfLists(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + first[0](i) + second[0](i)) | 0;
  return sum;
}

function calledByNameInWhile(n) {
  let sum = 0;
  let i = 0;
  while (i < n) {
    sum = (sum + same(i)) | 0;
    i += 2;
  }
  return sum;
}
function readOutOfListInWhile(n) {
  let sum = 0;
  let i = 0;
  while (i < n) {
    sum = (sum + first[0](i)) | 0;
    i += 2;
  }
  return sum;
}

class Sums {
  steps = [same];
  byName(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + same(i)) | 0;
    return sum;
  }
  outOfListInField(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + this.steps[0](i)) | 0;
    return sum;
  }
  outOfListOfModule(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + first[0](i)) | 0;
    return sum;
  }
}
const sums = new Sums();

const loops = {
  "a function called by its name": calledByName,
  "a function read out of a list": readOutOfList,
  "two functions called by their names": twoCalledByName,
  "two functions read out of two lists": twoReadOutOfLists,
  "a function called by its name in a while loop that steps by two": calledByNameInWhile,
  "a function read out of a list in a while loop that steps by two": readOutOfListInWhile,
  "a function called by its name in a method": n => sums.byName(n),
  "a function read out of a list in a field": n => sums.outOfListInField(n),
  "a function read out of a list of the module in a method": n => sums.outOfListOfModule(n),
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3), loops[name](2.5), loops[name](0), loops[name](-1), loops[name](NaN));
