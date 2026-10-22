const list = [3, undefined, , 1];
list.sort();
console.log(list.length, list[0] + 1, list[2] === undefined, 2 in list, 3 in list);
