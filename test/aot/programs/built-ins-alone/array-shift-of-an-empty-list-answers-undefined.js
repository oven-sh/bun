const list = [1.5];
console.log(list.shift() + 1);
const nothing = list.shift();
console.log(nothing === undefined, typeof nothing);
