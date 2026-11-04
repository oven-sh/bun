// what is thrown comes out of a call: the catch ignores the value, and the call still runs, counts, and may throw something itself
let calls = 0;
function make(fails: boolean) { calls++; if (fails) throw new RangeError("inside"); return { made: calls }; }
function subject(bad: unknown, fails: boolean) { try { if (bad) throw make(fails); return "fine"; } catch { return "caught" + calls; } }
function deed(bad: unknown, fails: boolean) { return subject(bad, fails); }
console.log(deed(false, false));
console.log(deed(true, false));
console.log(deed(true, true));
let text = "";
for (let i = 0; i < 6; i++) text += deed(i & 1, i > 3) + ";";
console.log(text);
console.log(String(calls));
