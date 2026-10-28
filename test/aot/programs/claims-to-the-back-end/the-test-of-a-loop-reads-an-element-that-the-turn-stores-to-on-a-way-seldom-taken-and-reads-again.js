// The test of a loop reads an element. The turn stores to that element on a way that is seldom taken and reads it again behind that way.
function total(list) {
  let sum = 0;
  let index = 0;
  while (list[index] !== -1) {
    if (list[index] === 100) list[index] = 3;
    sum += list[index];
    index++;
  }
  return sum;
}

const list = [];
for (let index = 0; index < 64; index++) list.push(index % 16 === 7 ? 100 : index);
list.push(-1);
console.log(total(list), list.join(" "));
