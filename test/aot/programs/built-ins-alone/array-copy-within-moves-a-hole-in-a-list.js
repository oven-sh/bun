const list = [1, 2, , 4];
list.copyWithin(0, 2);
console.log(list.length, 0 in list, list[0] === undefined, list[1] + 1);
