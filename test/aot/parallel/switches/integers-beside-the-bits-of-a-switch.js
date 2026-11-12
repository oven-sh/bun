// the cases of a row lie within 64 numbers, and it is asked about numbers 64 and 2 ** 32 away from a case, about the ends of int32 and about whole numbers past it: a shift that reads six bits of its amount, or a word cut to 32 bits, would take them for cases. A second row has its cases far apart
function near(k) { return k === 3 || k === 10 || k === 66; }
function negative(k) { return k === -5 || k === -1 || k === 2; }
function far(k) { return k === 1 || k === 70000 || k === 2147483647 || k === -2147483648; }
function deed(k) { return (near(k) ? "n" : "-") + (negative(k) ? "m" : "-") + (far(k) ? "f" : "-"); }
const values = [3, 10, 66, 2, 67, 3 + 64, 10 + 64, 66 + 64, 3 - 64, 3 + 2 ** 32, 10 - 2 ** 32, 66 + 2 ** 33, 3 + 2 ** 52, -5, -1, 2, -5 + 64, -1 - 64, 2 + 2 ** 32, 1, 70000, 2147483647, -2147483648, 2147483648, -2147483649, 1 + 2 ** 32, 2 ** 53, -(2 ** 53), 1e300, -1e300];
let out = "";
for (let i = 0; i < values.length; i++) out += deed(values[i]) + " ";
console.log(out);
let count = 0;
for (let k = -200; k < 200; k++) if (near(k) || negative(k)) count++;
console.log(String(count));
