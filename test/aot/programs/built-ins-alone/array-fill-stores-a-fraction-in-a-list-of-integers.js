const list = [1, 2, 3];
list.fill(0.5, 1);
console.log(list.length, list.map(each => typeof each).join());
console.log(list[0] + 1, list[1] + 1);
let total = 0;
for (const each of list) total += each;
console.log(total);
