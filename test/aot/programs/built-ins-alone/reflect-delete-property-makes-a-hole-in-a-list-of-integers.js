const list = [1, 2, 3];
Reflect.deleteProperty(list, 1);
console.log(list.length, 1 in list, list[1] === undefined);
console.log(list.findIndex(each => each === undefined));
let total = 0;
for (const each of list) total += each;
console.log(total);
