// A rounded quotient of integers is asked for through another name of Math.floor, and through a local that is named Math and is not: the callee goes by its binding.
const floor = Math.floor;
function byOtherName(a: number, b: number) {
    return floor((a | 0) / ((b & 7) + 1));
}
function byLocal(a: number, b: number) {
    const Math = { floor(x: number) { return x * 2; } };
    return Math.floor((a | 0) / ((b & 7) + 1));
}
function byParameter(round: (x: number) => number, a: number, b: number) {
    return round((a | 0) / ((b & 7) + 1));
}
function deed(a: number, b: number) {
    return String(byOtherName(a, b)) + " " + String(byLocal(a, b)) + " " + String(byParameter(Math.floor, a, b)) + " " + String(byParameter(Math.ceil, a, b)) + " " + String(byParameter(x => x, a, b));
}
const input = JSON.parse("[7, 1, -7, 3, -1, 7]");
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + i, input[1]);
console.log(last);
console.log(deed(input[2], input[3]), deed(input[4], input[5]));
console.log(String(1 / byParameter(Math.ceil, input[4], input[5])), String(1 / byParameter(Math.round, input[4], input[5])), String(1 / byParameter(Math.trunc, input[4], input[5])));
