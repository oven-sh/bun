// Outside the text charCodeAt gives NaN and s[i] gives undefined, where the code unit that stands beside them is -1: they are held against -1, against what lies below it, and against the empty text.
function againstMinusOne(s: string, i: number) {
    const c = s.charCodeAt(i);
    return String(c === -1) + " " + String(c > -2) + " " + String(c >= -1) + " " + String(c < 58) + " " + String(-1 == c);
}
function caseMinusOne(s: string, i: number) {
    switch (s.charCodeAt(i)) {
    case -1: return "minus one";
    case 97: return "a";
    }
    return "other";
}
function caseEmpty(s: string, i: number) {
    switch (s[i]) {
    case "": return "empty";
    case "a": return "a";
    }
    return "other";
}
function caseEmptyOfCharAt(s: string, i: number) {
    switch (s.charAt(i)) {
    case "": return "empty";
    case "a": return "a";
    }
    return "other";
}
function besideOne(s: string, i: number) {
    const c = s.charCodeAt(i);
    if (c >= 48)
        return c - 48;
    return c + 1;
}
function deed(s: string, i: number) {
    return againstMinusOne(s, i) + " " + caseMinusOne(s, i) + " " + caseEmpty(s, i) + " " + caseEmptyOfCharAt(s, i) + " " + String(besideOne(s, i));
}
const input = JSON.parse('["ab", 0, 1, 2, -1]');
console.log(deed(input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0], i & 1);
console.log(last);
console.log(deed(input[0], input[3]));
console.log(deed(input[0], input[4]));
console.log(deed("", 0));
