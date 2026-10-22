const list = [1, 2, 3];
Reflect.set(list, "length", 1);
console.log(list.length, list[1] === undefined, list[0] + 1);
let total = 0;
for (const each of list) total += each;
console.log(total);
