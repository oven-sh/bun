// a chain of `if` over comparisons with texts is asked about a rope that spells a case, a piece of a longer text, and 16-bit texts that differ from a case in one character
function verb(k) { if (k === "get") return "G"; else if (k === "set") return "S"; else if (k === "has") return "H"; else if (k === "hās") return "W"; return "-"; }
function ropeOf(a, b) { let text = a; text += b; return text; }
function deed(k) { return verb(k); }
const long = "xxgetxxsetxx";
const values = [ropeOf("g", "et"), ropeOf("se", "t"), ropeOf(ropeOf("h", "a"), "s"), long.slice(2, 5), long.substring(7, 10), "hās", ropeOf("hā", "s"), "gēt", "get\u0000", "", "GET", ropeOf("", "")];
let out = "";
for (let i = 0; i < values.length; i++) out += deed(values[i]);
console.log(out);
let all = "";
for (let turn = 0; turn < 300; turn++) all = deed(ropeOf("g", turn % 2 ? "et" : "ot")) + all.slice(0, 8);
console.log(all);
