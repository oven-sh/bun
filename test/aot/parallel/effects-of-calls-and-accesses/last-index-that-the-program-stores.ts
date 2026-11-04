// lastIndex of a RegExp is read behind a match, behind a store of a text and behind a store of an object
function deed(value: any) { const re = /a/g; re.test("banana"); const first = re.lastIndex; re.lastIndex = value; const second = re.lastIndex; return first + " " + typeof second + " " + String(second); }
console.log(deed(0));
console.log(deed("4"));
console.log(deed({ toString() { return "object"; } }));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? String(i) : i) + ";";
console.log(all);
