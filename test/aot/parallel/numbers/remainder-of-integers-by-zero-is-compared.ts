// A remainder of two int32 that is only compared gets a divisor of zero: NaN equals nothing and stands in no relation, where the integer that stands for it is 0.
function isMultiple(a: number, b: number) {
    return (a | 0) % (b | 0) === 0;
}
function isSmall(a: number, b: number) {
    return (a | 0) % (b | 0) < 1;
}
function isNotNegative(a: number, b: number) {
    return (a | 0) % (b | 0) >= 0;
}
function deed(a: number, b: number) {
    return String(isMultiple(a, b)) + " " + String(isSmall(a, b)) + " " + String(isNotNegative(a, b));
}
const input = JSON.parse("[12, 4, 0, 13]");
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + (i & 1), input[1]);
console.log(last);
console.log(deed(input[0], input[2]));
console.log(deed(input[2], input[2]));
console.log(deed(input[3], input[1]));
