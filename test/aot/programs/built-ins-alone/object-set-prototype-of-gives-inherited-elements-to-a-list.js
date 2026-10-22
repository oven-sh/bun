const list = [1, , 3];
Object.setPrototypeOf(list, { 1: "text", __proto__: Array.prototype });
console.log(list.length, 1 in list, typeof list[1], list[1].length);
console.log(list.map(each => typeof each).join());
