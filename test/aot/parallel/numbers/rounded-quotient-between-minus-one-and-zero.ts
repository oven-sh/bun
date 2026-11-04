// A quotient of two proven integers that lies between -1 and 0, or is 0 over a negative divisor, is rounded: each function of Math gives -0, which no integer is.
function up(a: number, b: number) {
    return 1 / Math.ceil((a | 0) / ((b & 7) + 1));
}
function nearest(a: number, b: number) {
    return 1 / Math.round((a | 0) / ((b & 7) + 1));
}
function cut(a: number, b: number) {
    return 1 / Math.trunc((a | 0) / ((b & 7) + 1));
}
function down(a: number, b: number) {
    return 1 / Math.floor((a & 255) / (-1 - (b & 7)));
}
function deed(a: number, b: number) {
    return String(up(a, b)) + " " + String(nearest(a, b)) + " " + String(cut(a, b)) + " " + String(down(a, b));
}
const input = JSON.parse("[8, 3, -1, 7, 0]");
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0] + i, input[1]);
console.log(last);
console.log(deed(input[2], input[3]));
console.log(deed(input[4], input[3]));
