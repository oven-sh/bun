const cards = ["\u{1f0a1}", "\u{1f0b2}", "\u{1f0ce}", "ab", "\xe9\xe8", "Āa", "aĀ", "\ud800\ud800", "\udc00x", "\0\0", "\x7f\x80", "zz"];
const texts = [];
for (let i = 0; i < cards.length; i++) for (let j = 0; j < cards.length; j += 5) texts.push(cards[i] + cards[j] + cards[(i + 3) % cards.length] + "\u{1f0a1}" + cards[(i * j) % cards.length]);
const kept = new Map();
function name(piece) { if (!kept.has(piece)) kept.set(piece, kept.size); return kept.get(piece); }
function ofText(text) { let out = ""; for (let i = 0; i <= text.length; i++) { const piece = text.slice(i, i + 2); out += piece.length + ":" + piece.codePointAt(0) + ":" + piece.charCodeAt(1) + ":" + name(piece) + " "; } return out; }
function ofPiece(text, from) { const piece = text.slice(from, from + 7); let out = ""; for (let i = 0; i <= piece.length; i++) { const two = piece.slice(i, i + 2); out += two.length + ":" + two.codePointAt(0) + ":" + two.charCodeAt(1) + ":" + name(two) + " "; } return out; }
function ofPieceOfPiece(text) { const piece = text.slice(1).slice(0, -1).slice(1, 8); return [piece.slice(0, 2), piece.substring(2, 4), piece.substr(3, 2), piece.slice(-2), piece.slice(-3, -1), piece.slice(5, 3), piece.slice(0, 1), piece.slice(0, 0)].map(two => two.length + "/" + name(two) + "/" + JSON.stringify(two)).join(" "); }
function ofJoined(text) { const joined = text + "\u{1f0a1}" + text; return name(joined.slice(text.length, text.length + 2)) + " " + name(joined.slice(1, 3)) + " " + (joined.slice(0, 2) === text.slice(0, 2)) + " " + (joined.slice(0, 2) + joined.slice(2, 4) === joined.slice(0, 4)); }
function keyed(text) { const table = { ab: 1, zz: 2, "\xe9\xe8": 3, "\u{1f0a1}": 4, "\0\0": 5 }; let sum = 0; for (let i = 0; i < text.length; i++) sum = sum * 2 + (table[text.slice(i, i + 2)] ?? 0); return sum % 1000003; }
const out = [];
for (let round = 0; round < 3; round++) for (const text of texts) out.push(ofText(text), ofPiece(text, round), ofPiece(text, 2), ofPieceOfPiece(text), ofJoined(text), keyed(text), keyed(text.slice(1, 9)));
let hash = 0;
for (const line of out) for (let i = 0, s = String(line); i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
console.log(hash, kept.size, out.length);
console.log(out.filter((_, i) => i % 41 == 0).join("\n"));
