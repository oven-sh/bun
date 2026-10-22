const list = [1.5, 2.5, 3.5];
Reflect.set(list, "length", 1);
console.log(list.length, list[1] === undefined, list[0] + 1);
let total = 0;
for (const each of list) total += each;
console.log(total);
