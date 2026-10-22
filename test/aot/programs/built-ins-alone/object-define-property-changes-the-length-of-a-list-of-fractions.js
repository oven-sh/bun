const list = [1.5, 2.5, 3.5];
Object.defineProperty(list, "length", { value: 5 });
console.log(list.length, 4 in list, list[4] === undefined);
console.log(list.findIndex(each => each === undefined));
