const list = [1, 2, 3];
Reflect.set(list, "length", 5);
console.log(list.length, 4 in list, list[4] === undefined);
console.log(list.findIndex(each => each === undefined));
