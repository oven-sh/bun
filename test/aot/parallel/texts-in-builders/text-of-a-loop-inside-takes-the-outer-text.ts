// two texts grow at once, one in the loop around and one in the loop inside, and each is a part of the other
function innerTakesOuter(rows: number, columns: number) { let s = ""; let out = ""; for (let i = 0; i < rows; i++) { s += "x" + i; let t = ""; for (let j = 0; j < columns; j++) t += s + "."; out = out + t + "|"; } return out + s; }
function outerTakesInner(rows: number, columns: number) { let s = ""; for (let i = 0; i < rows; i++) { let t = "("; for (let j = 0; j < columns; j++) t += j; s += t + ")"; } return s; }
function bothGrowInside(rows: number, columns: number) { let s = ""; let t = ""; for (let i = 0; i < rows; i++) { for (let j = 0; j < columns; j++) { s += "s" + j; t += s.length + ","; } s += ";"; } return s + "|" + t; }
console.log(JSON.stringify(innerTakesOuter(0, 2)), innerTakesOuter(1, 1), innerTakesOuter(3, 2), innerTakesOuter(2, 0));
console.log(JSON.stringify(outerTakesInner(0, 2)), outerTakesInner(1, 1), outerTakesInner(3, 4), outerTakesInner(2, 0));
console.log(bothGrowInside(0, 2), bothGrowInside(1, 1), bothGrowInside(3, 2), bothGrowInside(2, 0));
let lengths = 0;
for (let turn = 0; turn < 30; turn++) lengths += innerTakesOuter(turn % 5, turn % 3).length + outerTakesInner(turn % 5, turn % 3).length + bothGrowInside(turn % 5, turn % 3).length;
console.log(lengths);
