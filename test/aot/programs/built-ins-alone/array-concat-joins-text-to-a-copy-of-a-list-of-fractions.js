const list = [1.5, 2.5, 3.5];
const copy = list.concat("text", ["more"]);
console.log(copy.length, copy[0] + 1, copy[3].length, copy[4].length, list.length);
