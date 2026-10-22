const list = [1, 2, 3];
const removed = list.splice(1, 1, "text", "more");
console.log(list.length, list.map(each => typeof each).join());
console.log(removed.length, removed[0] + 1, list[1].length);
let total = 0;
for (const each of list) total += each;
console.log(total);
