// An int32 counter is compared in every turn with a number that no turn changes, and that number is NaN, an infinity, -0, a fraction and beyond every integer.
function count(limit: number) {
    const n = limit / 2;
    let i = 0;
    while (i < n && i < 40)
        i = (i + 1) | 0;
    return i;
}
function countDown(limit: number) {
    const n = limit / 2;
    let i = 10;
    while (n <= i && i > -40)
        i = (i - 1) | 0;
    return i;
}
function deed(limit: number) {
    return String(count(limit)) + " " + String(countDown(limit));
}
const input = JSON.parse("[9, 10, -9, 1e300, -1e300, 0.5, -0.5, 1e-300]");
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1]);
console.log(last);
for (let i = 2; i < input.length; i++)
    console.log(deed(input[i]));
console.log(deed(NaN), deed(Infinity), deed(-Infinity), deed(-0), deed(0));
