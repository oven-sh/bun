// Math.max and Math.min, with an operand that drops out by its range, get NaN and -0 in the operand that stays.
function atLeastZero(x: number, i: number) {
    return Math.max(x, i & 15, -1);
}
function atMostZero(x: number, i: number) {
    return Math.min(x, -(i & 15) - 1, 1);
}
function tell(x: number) {
    return x === 0 ? String(1 / x) : String(x);
}
function deed(x: number, i: number) {
    return tell(atLeastZero(x, i)) + " " + tell(atMostZero(x, i));
}
const input = JSON.parse("[3.5, 20, -20, 0, 16, 31]");
console.log(deed(input[0], input[3]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i % 3], i);
console.log(last);
console.log(deed(NaN, input[3]), deed(-0, input[3]), deed(-0, input[4]), deed(Infinity, input[5]), deed(-Infinity, input[5]));
console.log(tell(Math.max(-0, input[3] & 0)), tell(Math.min(-0, input[3] & 0)), tell(Math.max(input[3] & 0, -0)), tell(Math.min(input[3] & 0, -0)));
