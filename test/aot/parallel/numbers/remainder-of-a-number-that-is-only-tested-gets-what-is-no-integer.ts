// A remainder of a plain number that nothing reads but one test gets fractions, -0, NaN, the infinities and integers beyond 2 ** 53, where for integers it is divided as one.
function isFourth(y: number) {
    return y % 4 === 0;
}
function isOdd(y: number) {
    if (y % 2)
        return "odd";
    return "even";
}
function leavesThree(y: number) {
    return y % 5 === 3;
}
function deed(y: number) {
    return String(isFourth(y)) + " " + isOdd(y) + " " + String(leavesThree(y));
}
const input = JSON.parse("[8, 13, -8, -13, 8.5, -0.5, 9007199254740992, 9007199254740994, -9007199254740996, 1e300, 4.000000000000001, 2147483648, -2147483648]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1] + i);
console.log(last);
for (let i = 0; i < input.length; i++)
    console.log(deed(input[i]));
console.log(deed(NaN), deed(Infinity), deed(-Infinity), deed(-0), deed(0));
console.log(deed("8" as any), deed(null as any), deed(undefined as any), deed(true as any), deed({ valueOf() { return 13; } } as any));
