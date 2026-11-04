const list = [1, 2];
Object.freeze(list);
list[0] = 9; list[2] = 9;
console.log(list[0], list[2], list.length);
