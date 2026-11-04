// A remainder by 4 is compared with 4, which it never is, with -1, which takes the sign of the dividend, and has a dividend beyond int32, whose bit 31 is no sign.
function isFour(a: number) {
    return (a | 0) % 4 === 4;
}
function isMinusOne(a: number) {
    return (a | 0) % 4 === -1;
}
function ofWide(a: number) {
    return ((a | 0) * 3) % 4 === 1;
}
function deed(a: number) {
    return String(isFour(a)) + " " + String(isMinusOne(a)) + " " + String(ofWide(a));
}
const input = JSON.parse("[5, 4, -1, 3, 715827883, -5]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + i * 4);
console.log(last);
console.log(deed(input[1]));
console.log(deed(input[2]), deed(input[3]), deed(input[5]));
console.log(deed(input[4]));
