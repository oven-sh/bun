const set = new Set();
set.add(1.5);
const list = [...set];
console.log(list.length, list[0], list[0] + 1, typeof list[0]);
