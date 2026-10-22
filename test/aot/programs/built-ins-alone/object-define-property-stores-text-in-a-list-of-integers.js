const list = [1, 2, 3];
Object.defineProperty(list, 0, { value: "text" });
console.log(list.length, list.map(each => typeof each).join());
console.log(list[0].length);
let total = 0;
for (const each of list) total += each;
console.log(total);
