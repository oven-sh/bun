const word = ["con", "struc", "tor"].join("");
const other = "con".padEnd(11, "structor");
const third = "rotcurtsnoc".split("").reverse().join("");
console.log(word, other, third, word === other, other === third);
