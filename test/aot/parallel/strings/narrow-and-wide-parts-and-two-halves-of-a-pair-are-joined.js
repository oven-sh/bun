// known texts of 8 and of 16 bits are joined, and two lone halves of a pair, and the length, the code units, comparisons and pieces of what is made are read
function subject(on) { const wide = on ? "中" : "中"; const high = on ? "\ud83d" : "\ud83d"; const low = on ? "\ude00" : "\ude00"; const t = "ab" + wide; const pair = "a" + high + low; return [t.length, t === "ab中", t < "ab丮", t.charCodeAt(2), t.slice(0, 2) === "ab", pair.length, pair === "a\u{1f600}", pair.codePointAt(1), (t + pair).length, JSON.stringify(t + pair)].join(); }
function deed(on) { return subject(on); }
console.log(deed(true));
console.log(deed(false));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i % 2 === 0);
console.log(text);
