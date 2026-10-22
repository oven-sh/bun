const list = [1.5, 2.5, 3.5];
list.unshift("text");
console.log(list.length, list.map(each => typeof each).join());
console.log(list[0].length, list[1] + 1);
let total = 0;
for (const each of list) total += each;
console.log(total);
