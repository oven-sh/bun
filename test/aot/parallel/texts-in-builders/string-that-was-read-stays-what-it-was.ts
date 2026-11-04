// strings that turns have read off the growing text are kept while it grows on: past the room of its buffer, and from one byte a character to two
function digest(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ":" + h; }
function states(n: number, wideAt: number) { const kept: string[] = []; let s = ""; for (let i = 0; i < n; i++) { s += i === wideAt ? "Ā" : "k" + i; kept[i] = s; } let expected = ""; let wrong = 0; for (let i = 0; i < n; i++) { expected = expected + (i === wideAt ? "Ā" : "k" + i); if (kept[i] !== expected) wrong++; } return wrong + " " + digest(s) + " " + digest(kept.join("|")); }
function readTwice(n: number) { let s = ""; let out = ""; for (let i = 0; i < n; i++) { s += "k" + i; const one = s; s += "-"; const two = s; out = out + one.length + "," + two.length + "," + (one + "-" === two) + ";"; } return out; }
function readInAnArmAndBehind(n: number) { let s = ""; let a = 0; let b = 0; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 2) a += s.charCodeAt(1); b += s.charCodeAt(0) + s.lastIndexOf("k"); } return a + "," + b + "," + s; }
function grownApart(n: number) { let s = ""; let fork = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i === 2) fork = s + "fork"; } return fork + "|" + s; }
console.log(states(0, 9), states(1, 9), states(6, 9), states(6, 3), states(6, 0));
console.log(states(3000, 9999), states(3000, 1500), states(3000, 2999));
console.log(readTwice(0).length, readTwice(1), readTwice(4));
console.log(readInAnArmAndBehind(0), readInAnArmAndBehind(1), readInAnArmAndBehind(5));
console.log(grownApart(0), grownApart(3), grownApart(6));
