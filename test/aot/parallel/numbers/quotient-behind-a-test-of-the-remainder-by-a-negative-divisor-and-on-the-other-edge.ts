// Two int32 are divided behind a test of their remainder: with a negative divisor 0 gives -0, and on the edge where something is left the quotient is a fraction.
function wholeBelow(a: number, b: number) {
    const x = a | 0;
    const d = -1 - (b & 7);
    if (x % d === 0)
        return 1 / (x / d);
    return "left";
}
function broken(a: number, b: number) {
    const x = a | 0;
    const d = (b & 7) + 1;
    if (x % d === 0)
        return "nothing left";
    return x / d;
}
function deed(a: number, b: number) {
    return String(wholeBelow(a, b)) + " " + String(broken(a, b));
}
const input = JSON.parse("[8, 3, 0, 7, 9]");
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] * (i + 1), input[1]);
console.log(last);
console.log(deed(input[2], input[1]));
console.log(deed(input[4], input[1]), deed(input[3], input[3]));
