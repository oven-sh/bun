const list = [1];
Object.preventExtensions(list);
list[1] = 2; list[0] = 3;
console.log(list[0], list[1], list.length);
