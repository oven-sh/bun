const list = [1, 2, 3];
const copy = list.toSpliced(1, 1, "text");
console.log(copy[1].length, list[1] + 1, copy.length);
