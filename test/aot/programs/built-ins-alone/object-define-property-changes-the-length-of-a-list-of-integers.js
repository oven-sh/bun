const list = [1, 2, 3];
Object.defineProperty(list, "length", { value: 5 });
console.log(list.length, 4 in list, list[4] === undefined);
console.log(list.findIndex(each => each === undefined));
