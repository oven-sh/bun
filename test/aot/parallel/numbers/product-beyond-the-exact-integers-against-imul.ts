// Two int32 are multiplied under `| 0` and by Math.imul, with a product beyond 2 ** 53: the rounded product has other low bits than the integer product.
function rounded(a: number, b: number) {
    return ((a | 0) * (b | 0)) | 0;
}
function exact(a: number, b: number) {
    return Math.imul(a, b);
}
function exactOfIntegers(a: number, b: number) {
    return Math.imul(a | 0, b | 0);
}
function exactOfSmall(a: number, b: number) {
    return Math.imul(a & 255, b & 255);
}
function deed(a: number, b: number) {
    return String(rounded(a, b)) + " " + String(exact(a, b)) + " " + String(exactOfIntegers(a, b)) + " " + String(exactOfSmall(a, b));
}
const input = JSON.parse("[3, 5, 2147483647, 2147483647, -2147483648, 2147483645, 4294967295.5, 1e20]");
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + i, input[1]);
console.log(last);
console.log(deed(input[2], input[3]));
console.log(deed(input[4], input[5]), deed(input[6], input[1]), deed(input[7], input[0]));
console.log(deed(NaN, 1), deed(Infinity, 1), deed(-0, -1), String(1 / exact(-0, 5)), String(1 / exact(input[0], 0)));
