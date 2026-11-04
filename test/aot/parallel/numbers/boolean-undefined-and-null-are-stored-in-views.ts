// Booleans, undefined and null are stored in views of integers, of floats and in a clamped one: each is converted as a number is made of it, and undefined is NaN in a float and 0 in an integer.
function store(view: any, i: number, flag: any) {
    const value: any = flag === "yes" ? true : flag === "no" ? false : flag === "none" ? null : undefined;
    view[i] = value;
}
function deed(flag: any) {
    const bytes = new Uint8Array(2);
    const floats = new Float64Array(2);
    const clamped = new Uint8ClampedArray(2);
    bytes[0] = 9;
    floats[0] = 9;
    clamped[0] = 9;
    storeInBytes(bytes, flag);
    storeInFloats(floats, flag);
    store(clamped, 0, flag);
    return String(bytes[0]) + " " + String(floats[0]) + " " + String(clamped[0]);
}
function storeInBytes(view: Uint8Array, flag: any) {
    const value: any = flag === "yes" ? true : flag === "no" ? false : flag === "none" ? null : undefined;
    view[0] = value;
}
function storeInFloats(view: Float64Array, flag: any) {
    const value: any = flag === "yes" ? true : flag === "no" ? false : flag === "none" ? null : undefined;
    view[0] = value;
}
const input = JSON.parse('["yes", "no", "none", "nothing"]');
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1]);
console.log(last);
console.log(deed(input[2]), deed(input[3]), deed(input[0]));
