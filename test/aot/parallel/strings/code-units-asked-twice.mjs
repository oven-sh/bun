// The code unit of one place asked twice and more: ranges, switches, both widths, ropes, surrogates, places past the end, places that change between, texts that change between.
const out = [];
const digit = (s, i) => i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57;
const past = (s, i) => s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57;
function run(s) { let n = 0, i = 0; while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) { n = n * 10 + s.charCodeAt(i) - 48; i++; } return n + ":" + i; }
function moves(s) { let t = 0; for (let i = 0; i < s.length - 1; i++) { if (s.charCodeAt(i) === s.charCodeAt(i + 1)) t++; i++; if (s.charCodeAt(i) >= 97) t += s.charCodeAt(i); } return t; }
function changes(s, u) { let t = 0; for (let i = 0; i < 4; i++) { const a = s.charCodeAt(i); [s, u] = [u, s]; t = t * 31 + a - s.charCodeAt(i); if (s.charCodeAt(i) === a) t++; } return t; }
let rope = ""; for (let i = 0; i < 40; i++) rope += i % 3 ? "7" : "x";
const texts = ["", "1", "12a", "a12", "١٢", "9\u{1f600}9", "\ud83d", "0123456789", rope, "77" + rope, "é"];
for (const s of texts) { let t = ""; for (let i = -1; i < s.length + 2; i++) t += (i >= 0 && digit(s, i) ? 1 : 0) + "" + (past(s, i) ? 1 : 0); out.push(t, run(s), moves(s), changes(s, "1234"), changes(s + " zz", s)); }
console.log(out.join(" "));
