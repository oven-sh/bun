const list = [1, 2, 3];
list.push("text");
console.log(list.length, list.map(each => typeof each).join());
console.log(list[3].length);
let total = 0;
for (const each of list) total += each;
console.log(total);
