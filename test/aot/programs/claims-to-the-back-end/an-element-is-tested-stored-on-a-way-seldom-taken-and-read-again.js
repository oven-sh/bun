// An element is read and tested, stored to on a way that is seldom taken, and read again behind that way: in a function without a loop, and in one turn of a loop that also calls.
function twice(list, index) {
  const before = list[index];
  if (before === 100) list[index] = 3;
  return before * 1000 + list[index];
}

const seen = [];
function note(value) {
  if (seen.length < 4) seen.push(value);
}

function total(list) {
  let sum = 0;
  for (let index = 0; index < list.length; index++) {
    if (list[index] === 100) list[index] = 3;
    sum += list[index];
    note(sum);
  }
  return sum;
}

function marked() {
  const list = [];
  for (let index = 0; index < 64; index++) list.push(index % 16 === 7 ? 100 : index);
  return list;
}

const first = marked();
let sum = 0;
for (let index = 0; index < first.length; index++) sum += twice(first, index);
console.log(sum, first.join(" "));
const second = marked();
console.log(total(second), second.join(" "), seen.join(" "));
