// a text is joined with whatever is handed over on one side and with a number on the other, and joined with more behind both sides: objects with toString and valueOf are handed over, and each is asked once and in its turn
let log = "";
const both = { toString() { log += "s"; return "S"; }, valueOf() { log += "v"; return "V"; } };
const only = { toString() { log += "t"; return "T"; }, valueOf: undefined };
function subject(c, o, n) { const s = c ? "a" + o : "b" + n; log += "|"; return s + "!"; }
function deed(c, o, n) { return subject(c, o, n) + log; }
console.log(deed(true, 1, 2), deed(true, both, 2), deed(false, both, 2), deed(1, only, 3), deed(1, [1, [2]], 3), deed(1, null, 3));
log = "";
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(i % 2, i % 3 ? both : i, i).length;
console.log(String(lengths), String(log.length));
log = "";
try { console.log(deed(JSON.parse("1"), Symbol("s"), 0)); } catch (e) { console.log(e.name, log); }
