const list = [1, 2, 3];
list.shift();
list.shift();
list.shift();
const first = list.shift();
console.log(list.length, first === undefined, typeof first, list[0] === undefined);
