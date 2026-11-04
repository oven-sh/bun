// A direct eval gets a number, a boolean, undefined, null, a symbol and a BigInt, which it hands back, and then a text that reads a local, which it evaluates.
function handBack(n: unknown) {
    const local = 41;
    if (typeof n === "number")
        return eval((+n) as any);
    if (typeof n === "boolean" || n === undefined || n === null)
        return eval(n as any);
    return eval(n as any) ?? local;
}
function deed(n: unknown) {
    const given = handBack(n);
    return typeof given + " " + String(given) + " " + String(given === n);
}
const input = JSON.parse('[7, -0.5, true, null, "local + 1", "n"]');
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1]);
console.log(last);
console.log(deed(input[2]), deed(input[3]), deed(undefined), deed(NaN), String(1 / (handBack(-0) as number)));
console.log(deed(input[4]), deed(input[5]), deed(10n), typeof handBack(Symbol.iterator));
const object = { toString() { return "local"; } };
console.log(String(handBack(object) === object));
