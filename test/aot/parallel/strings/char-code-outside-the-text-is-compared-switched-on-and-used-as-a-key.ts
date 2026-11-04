// What charCodeAt gives outside the text, NaN, is compared, switched on, subtracted from and used as a key, where inside the text all of it goes by the code unit.
const table = new Uint8Array(128);
table[97] = 1;
table[48] = 2;
function classify(s: string, i: number) {
    const c = s.charCodeAt(i);
    let out = "";
    out += c === 97 ? "a " : "- ";
    out += c < 58 ? "below " : "- ";
    out += c >= 48 ? "atLeast " : "- ";
    out += !(c > 57) ? "notAbove " : "- ";
    out += c !== c ? "nan " : "- ";
    switch (c) {
    case 97: out += "A "; break;
    case 48: out += "0 "; break;
    default: out += "other ";
    }
    if (c >= 48)
        out += String(c - 48) + " ";
    if (c < 128)
        out += String(table[c]);
    else
        out += String((table as any)[c]);
    return out;
}
function deed(s: string, i: number) {
    return classify(s, i);
}
const input = JSON.parse('["a0\\u0100", "", 0, 1, 2, 3, -1, 1.5]');
console.log(deed(input[0], input[2]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[0], i & 1);
console.log(last);
for (let i = 2; i < input.length; i++)
    console.log(deed(input[0], input[i]), "|", deed(input[1], input[i]));
console.log(deed(input[0], NaN), "|", deed(input[0], Infinity), "|", deed(input[0], -0));
