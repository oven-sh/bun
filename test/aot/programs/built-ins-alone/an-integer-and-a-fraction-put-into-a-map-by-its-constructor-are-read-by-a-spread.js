const held = new Map([["a", 7], ["b", 1.5]]);
const list = [...held];
console.log(list[0][1] + 1, list[1][1] + 1);
console.log(list[0][0].length);
