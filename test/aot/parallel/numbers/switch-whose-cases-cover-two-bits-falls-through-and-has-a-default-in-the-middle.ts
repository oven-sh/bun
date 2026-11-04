// A switch on two bits names all four integers, falls through, and has its default in the middle: the way of the default is never gone, and the last case is taken without a test.
function name(x: number) {
    let out = "";
    switch (x & 3) {
    case 0:
        out += "zero ";
    case 1:
        out += "one ";
        break;
    default:
        out += "default ";
    case 3:
        out += "three ";
        break;
    case 2:
        out += "two ";
    }
    return out;
}
function deed(x: number) {
    return name(x) + "| " + name(x + 1);
}
const input = JSON.parse("[0, 1, 2, 3, -1, 4294967298, 2.9, -2.9]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last += i < 4 ? deed(i) : "";
console.log(last);
for (let i = 0; i < input.length; i++)
    console.log(deed(input[i]));
console.log(deed(NaN), deed(-0), deed(Infinity), deed("3" as any), deed(null as any), deed({ valueOf() { return 2; } } as any));
