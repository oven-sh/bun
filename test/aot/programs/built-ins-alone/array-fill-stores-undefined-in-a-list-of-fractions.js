const list = [1.5, 2.5, 3.5];
list.fill(undefined, 2);
console.log(list.length, list.map(each => typeof each).join());
console.log(list[2] === undefined, 2 in list);
let total = 0;
for (const each of list) total += each;
console.log(total);
