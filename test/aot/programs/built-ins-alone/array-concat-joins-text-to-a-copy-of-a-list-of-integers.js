const list = [1, 2, 3];
const copy = list.concat("text", ["more"]);
console.log(copy.length, copy[0] + 1, copy[3].length, copy[4].length, list.length);
