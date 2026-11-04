// An int32 is compared with 2.5 and -2.5 by all four relations and from both sides: the fraction is rounded up for some and down for the others.
function against(a: number) {
    const v = a | 0;
    return (v < 2.5 ? "a" : "-") + (v <= 2.5 ? "b" : "-") + (v > 2.5 ? "c" : "-") + (v >= 2.5 ? "d" : "-") + (2.5 < v ? "e" : "-") + (2.5 <= v ? "f" : "-") + (2.5 > v ? "g" : "-") + (2.5 >= v ? "h" : "-");
}
function againstNegative(a: number) {
    const v = a | 0;
    return (v < -2.5 ? "a" : "-") + (v <= -2.5 ? "b" : "-") + (v > -2.5 ? "c" : "-") + (v >= -2.5 ? "d" : "-");
}
function deed(a: number) {
    return against(a) + " " + againstNegative(a);
}
const input = JSON.parse("[0, 2, 3, -2, -3]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + (i & 1));
console.log(last);
console.log(deed(input[1]));
console.log(deed(input[2]));
console.log(deed(input[3]));
console.log(deed(input[4]));
