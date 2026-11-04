// A remainder of two int32 stands in a sum with an integer: as -0 on the left of a subtraction it shows, and as NaN, by a divisor of zero, it shows everywhere.
function minuend(a: number) {
    return 1 / (((a | 0) % 3) - (a & 1));
}
function addend(a: number) {
    return 1 / (((a | 0) % 3) + (a & 1));
}
function byAny(a: number, b: number) {
    return ((a | 0) % (b | 0)) + 1;
}
function deed(a: number, b: number) {
    return String(minuend(a)) + " " + String(addend(a)) + " " + String(byAny(a, b));
}
const input = JSON.parse("[5, 3, -6, 0]");
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + i * 6, input[1]);
console.log(last);
console.log(deed(input[2], input[1]));
console.log(deed(input[0], input[3]));
