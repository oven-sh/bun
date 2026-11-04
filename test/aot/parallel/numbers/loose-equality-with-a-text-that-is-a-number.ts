// A value is loosely compared with texts that convert to numbers, "12", "" and "Infinity": the number, false and the infinity equal them, as no number equals a word.
function isTwelve(x: any) {
    return x == "12";
}
function isEmpty(x: any) {
    return x == "";
}
function isEndless(x: any) {
    return x == "Infinity";
}
function deed(x: any) {
    return String(isTwelve(x)) + " " + String(isEmpty(x)) + " " + String(isEndless(x));
}
const input = JSON.parse('["12", "13", 12, 0, false, [12], []]');
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1]);
console.log(last);
console.log(deed(input[2]));
console.log(deed(input[3]), deed(input[4]), deed(Infinity), deed(12n));
console.log(deed(input[5]), deed(input[6]), deed(null), deed(undefined));
