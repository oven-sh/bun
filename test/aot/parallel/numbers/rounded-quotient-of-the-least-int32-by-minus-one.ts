// The least int32 is divided by -1 under Math.floor, where both are proven integers that are never zero: the quotient leaves int32.
function divide(a: number, b: number) {
    const dividend = -1 - (a & 0x7fffffff);
    const divisor = -1 - (b & 7);
    return Math.floor(dividend / divisor);
}
function deed(a: number, b: number) {
    return String(divide(a, b)) + " " + String(divide(a, b) + 1);
}
const input = JSON.parse("[2147483647, 0, 2147483646, 7, 0, 1]");
console.log(deed(input[0], input[1]));
let log = "";
for (let i = 0; i < 300; i++)
    log = deed(input[0] - (i & 1), input[(i & 1) * 2 + 1]);
console.log(log);
console.log(deed(input[4], input[5]), deed(input[2], input[3]), deed(input[0], input[1]));
