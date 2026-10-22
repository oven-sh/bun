const list = [1.5, 2.5, 3.5];
list.pop();
list.pop();
list.pop();
const last = list.pop();
console.log(list.length, last === undefined, typeof last, list[0] === undefined);
