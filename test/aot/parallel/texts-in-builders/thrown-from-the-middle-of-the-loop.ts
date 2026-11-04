// the loop of the growing text is left by a throw: of the text itself, of something else, and out of a function that a turn calls
function throwsText(n: number, stop: number) { let s = "!"; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) throw s; } return s; }
function throwsError(n: number, stop: number) { let s = "!"; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) throw new RangeError("at " + i); } return s; }
function refuse(i: number, stop: number) { if (i === stop) throw new TypeError("refused " + i); return i; }
function calleeThrows(n: number, stop: number) { let s = "!"; for (let i = 0; i < n; i++) s += "k" + refuse(i, stop); return s; }
function tell(f: () => unknown) { try { return "gave " + f(); } catch (e) { return "caught " + (e instanceof Error ? e.name + ": " + e.message : typeof e + " " + e); } }
console.log(tell(() => throwsText(0, 0)), tell(() => throwsText(4, 9)), tell(() => throwsText(4, 0)), tell(() => throwsText(4, 3)));
console.log(tell(() => throwsError(4, 9)), tell(() => throwsError(4, 0)), tell(() => throwsError(4, 3)));
console.log(tell(() => calleeThrows(4, 9)), tell(() => calleeThrows(4, 0)), tell(() => calleeThrows(4, 3)));
let lengths = 0;
for (let turn = 0; turn < 80; turn++) lengths += tell(() => throwsText(9, turn % 11)).length + tell(() => throwsError(9, turn % 11)).length + tell(() => calleeThrows(9, turn % 11)).length;
console.log(lengths, tell(() => calleeThrows(12, 99)));
