// A quotient of two int32 under `| 0` gets a divisor of zero, a dividend of zero with it, and the least int32 over -1.
function cut(a: number, b: number) {
    return ((a | 0) / (b | 0)) | 0;
}
function deed(pairs: number[]) {
    let out = "";
    for (let i = 0; i + 1 < pairs.length; i += 2)
        out += String(cut(pairs[i], pairs[i + 1])) + " ";
    return out;
}
const ordinary = JSON.parse("[7, 2, -7, 2, 9, 3, 1, 4]");
const hostile = JSON.parse("[7, 0, -7, 0, 0, 0, -2147483648, -1, 2147483647, -1, -2147483648, 1, 1, -2147483648]");
console.log(deed(ordinary));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(ordinary);
console.log(last);
console.log(deed(hostile));
console.log(deed(ordinary));
