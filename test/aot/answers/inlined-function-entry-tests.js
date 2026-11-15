// answers: without-library
// # Two functions answer at once on their usual way and do long work on the other. The usual way is copied into the loop that calls them, the other is still called: it is taken on some turns.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
let calls = 0;
function slow(text) { calls++; let sum = 0, odd = 0, even = 0, most = 0, least = 65536, said = ""; for (let at = 0; at < text.length; at++) { const code = text.charCodeAt(at); sum += code; if (code & 1) odd += code; else even += code; if (code > most) most = code; if (code < least) least = code; said = String.fromCharCode(code) + said; } for (let at = 0; at < said.length; at++) sum += said.charCodeAt(at) * at; for (let at = said.length; at > 0; at--) sum -= at; return sum + odd * 2 + even * 3 + most - least; }
function cached(table, key) { const found = table[key]; if (found !== undefined) return found; const made = slow(key); table[key] = made; let more = 0; for (let at = 0; at < key.length; at++) more += slow(key.slice(at)); table[key + "!"] = more; return made; }
function checked(value) { if (typeof value === "number") return value + 1; let text = ""; for (let at = 0; at < 3; at++) text += slow(String(value) + at) + ","; for (let at = 0; at < 3; at++) text += slow(text.slice(at, at + 2)) + ";"; return text; }
function run(turns) { const table = {}; let said = ""; for (let turn = 0; turn < turns; turn++) { said += cached(table, turn % 3 ? "ab" : "abc") + ","; said += checked(turn % 5 ? turn : "t" + turn) + ";"; said += cached(table, "ab!") + "."; } return said + calls; }
report(run(1)); report(run(7)); report(run(12));
report("end");
