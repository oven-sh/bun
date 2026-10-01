// prints each `; `-separated statement of a one-line code with its 1-based start column
const code = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"))[+process.argv[3] || 0];
let col = 1;
for (const part of code.split(/(?<=;) /)) { console.log(String(col).padStart(4), part); col += part.length + 1; }
