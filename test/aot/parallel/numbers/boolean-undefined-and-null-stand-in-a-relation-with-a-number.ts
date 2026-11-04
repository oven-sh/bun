// A boolean, undefined and null stand in a relation with a number: each becomes a number first, and undefined becomes NaN.
function below(flag: any, n: number) {
    const isSet: any = flag === "set";
    return isSet < n;
}
function atLeast(nothing: any, n: number) {
    const value: any = nothing === 1 ? undefined : null;
    return n >= value;
}
function deed(flag: any, n: number) {
    return String(below(flag, n)) + " " + String(atLeast(flag, n));
}
const input = JSON.parse('["set", "clear", 1, 0.5, 1, 1.5, 0, -1]');
console.log(deed(input[0], input[3]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1], input[3 + (i % 5)]);
console.log(last);
for (let i = 0; i < 3; i++) {
    for (let j = 3; j < input.length; j++)
        console.log(deed(input[i], input[j]));
}
console.log(deed("set", NaN), deed(1, NaN), deed("clear", -0), deed(1, Infinity));
