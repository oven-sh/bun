// The least int32 is divided by -1 for its remainder, which is -0: the processor's division of those two traps.
function leaves(a: number, b: number) {
    return (a | 0) % (b | 0) === 0 ? "nothing" : "something";
}
function truth(a: number, b: number) {
    return (a | 0) % (b | 0) ? "something" : "nothing";
}
function bits(a: number, b: number) {
    return ((a | 0) % (b | 0)) | 0;
}
function deed(a: number, b: number) {
    return leaves(a, b) + " " + truth(a, b) + " " + String(bits(a, b));
}
const input = JSON.parse("[-2147483648, -1, 7, 3]");
console.log(deed(input[2], input[3]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[2] + i, input[3]);
console.log(last);
console.log(deed(input[0], input[1]));
console.log(deed(input[0], input[3]));
