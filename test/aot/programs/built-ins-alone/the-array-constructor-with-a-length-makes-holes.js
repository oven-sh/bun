const list = new Array(3);
console.log(list.length, 0 in list, list[0] === undefined, list.findIndex(each => each === undefined));
