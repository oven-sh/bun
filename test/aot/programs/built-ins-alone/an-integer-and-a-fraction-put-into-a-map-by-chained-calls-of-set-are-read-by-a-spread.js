const held = new Map().set("a", 7).set("b", 1.5);
const list = [...held];
console.log(list[0][1] + 1, list[1][1] + 1);
console.log(list[0][0].length);
