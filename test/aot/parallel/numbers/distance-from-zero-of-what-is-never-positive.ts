// Math.abs gets an integer that is proven never positive and may be 0: the negation of 0 is -0, which Math.abs never gives.
function distance(a: number) {
    return 1 / Math.abs(0 - (a & 255));
}
function distanceOfNegative(a: number) {
    return 1 / Math.abs(-1 - (a & 255));
}
function deed(a: number) {
    return String(distance(a)) + " " + String(distanceOfNegative(a));
}
const input = JSON.parse("[4, 0, 256]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + (i & 3));
console.log(last);
console.log(deed(input[1]));
console.log(deed(input[2]));
