// A view is read under -0, which is the key "0", and under an integer that is proven never positive and may be 0: both name its first element.
function underMinusZero(view: Uint8Array) {
    return view[-0];
}
function underNoPositive(view: Uint8Array, i: number) {
    return view[0 - (i & 3)];
}
function underNegative(view: Uint8Array, i: number) {
    return view[-1 - (i & 3)];
}
function deed(i: number) {
    const view = new Uint8Array(2);
    view[0] = 9;
    return String(underMinusZero(view)) + " " + String(underNoPositive(view, i)) + " " + String(underNegative(view, i));
}
const input = JSON.parse("[1, 0, 4]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(1 + (i & 1));
console.log(last);
console.log(deed(input[1]));
console.log(deed(input[2]));
