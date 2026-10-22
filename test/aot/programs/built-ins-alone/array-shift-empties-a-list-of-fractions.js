const list = [1.5, 2.5, 3.5];
list.shift();
list.shift();
list.shift();
const first = list.shift();
console.log(list.length, first === undefined, typeof first, list[0] === undefined);
