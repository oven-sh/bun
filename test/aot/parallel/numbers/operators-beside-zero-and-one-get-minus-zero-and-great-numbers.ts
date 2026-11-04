// A proven number is added to 0, has 8 added and itself taken away, and 0 is shifted by it: -0 + 0 is 0, a great number swallows the 8, and a shift of 0 is 0.
function plusZero(x: number) {
    return 1 / (x + 0);
}
function distance(x: number) {
    return (x + 8) - x;
}
function noneShifted(x: number) {
    return 0 << x;
}
function deed(x: number) {
    return String(plusZero(x)) + " " + String(distance(x)) + " " + String(noneShifted(x));
}
const input = JSON.parse("[4, 1e300, 32, 64.5]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + i);
console.log(last);
console.log(deed(-0));
console.log(deed(input[1]), deed(NaN), deed(Infinity));
console.log(deed(input[2]), deed(input[3]));
