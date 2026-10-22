const list = [1.5, ,];
const nothing = list.pop();
console.log(nothing === undefined, typeof nothing, list.length);
