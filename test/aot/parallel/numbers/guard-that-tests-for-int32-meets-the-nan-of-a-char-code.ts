// a parameter written `number` is filled with char codes alone, which are int32 but for the NaN behind the end of the text
function isLetter(ch: number) { return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122; }
function countLetters(text: string) { let n = 0; for (let i = 0; i <= text.length; i++) if (isLetter(text.charCodeAt(i))) n++; return n; }
function deed(text: string) { return String(countLetters(text)) + " " + String(isLetter(text.charCodeAt(text.length))) + " " + String(isLetter(text.charCodeAt(-1))); }
console.log(deed("a1B2"), deed(""));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed("x".repeat(turn & 7) + "9Z");
console.log(last);
console.log(deed("\u{1F600}z"), deed("@[`{"), deed("AZaz"));
