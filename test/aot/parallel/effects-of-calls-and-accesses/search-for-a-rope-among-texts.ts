// a list of texts and numbers is searched for a number, for a flat text and for a rope that spells an element
function deed(needle: unknown) { const xs: unknown[] = ["ab", 1, "1", "abcdefghijklmnopqrstuvwxyz"]; return xs.indexOf(needle) + " " + xs.includes(needle); }
let rope = "";
for (let i = 0; i < 26; i++) rope += String.fromCharCode(97 + i);
console.log(deed(1));
console.log(deed("1"));
console.log(deed(rope));
console.log(deed(rope + "!"));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? i : String(i)) + ";";
console.log(all);
