const list = Array.from({ 0: 123, 1: 456, length: 3 });
console.log(list.length, list[0] + 1, list[2] === undefined, 2 in list);
