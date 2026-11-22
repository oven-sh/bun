// A global match whose list is read for its length or its truth alone is counted; whoever reads more has the matches.
const lines = "let some = text + 1;\n".repeat(37) + "last";
const wide = "中 a\n\u{1F600} a 中\n";
const subjects = ["", "a", lines, wide, lines.substring(3, 90), "a" + String(lines.length) + "\na", "aaaa abab aa"];
const count = s => (s.match(/\n/g) || []).length;
const optional = s => s.match(/aa/g)?.length ?? -1;
function tested(s) { const m = s.match(/a|b/g); return m ? m.length : "none"; }
function compared(s) { const m = s.match(/[a-z]+/g); return m === null ? "null" : m.length > 2; }
const words = s => { let n = 0; const m = s.match(/\b/g); if (m) for (let i = 0; i < m.length; i++) n += i; return n; };
const empty = s => (s.match(/x*/g) || []).length;
const unicode = s => (s.match(/\u{1F600}|中/gu) || []).length;
const captured = s => !!s.match(/(a)(b)?/g);
for (let i = 0; i < 3; i++)
    console.log(subjects.map(s => [count(s), optional(s), tested(s), compared(s), words(s), empty(s), unicode(s), captured(s)].join(":")).join(" "));
// The same literal in a function that is copied to where its list is read and to where it is counted.
const all = s => s.match(/a+/g);
const numbers = list => { let n = 0; for (const s of list) { const m = all(s); n += m ? m.length : 0; } return n; };
const names = list => { const out = []; for (const s of list) out.push(all(s)?.join("/")); return out.join(); };
console.log(numbers(subjects), names(subjects), numbers(subjects));
const first = s => { const m = s.match(/a./g); return m ? m.length + m[0] : "-"; };
const listed = s => [...(s.match(/a/g) || [])].length + JSON.stringify(s.match(/b/g));
const stored = s => { const m = s.match(/a/g); if (m) { m.length = 1; return m.length + m[0]; } return 0; };
let kept;
const held = s => (kept = s.match(/a/g), kept ? kept.length : 0);
console.log(subjects.map(s => [first(s), listed(s), stored(s), held(s), kept?.[0]].join(":")).join(" "));
// What the last match left behind.
const left = s => { const n = (s.match(/a/g) || []).length; return n + RegExp["$&"] + RegExp.leftContext.length; };
const leftBySet = s => { const n = (s.match(/(\d)/g) || []).length; return n + RegExp.$1 + RegExp.rightContext.length; };
console.log(subjects.map(s => left(s) + "," + leftBySet(s)).join(" "));
// Receivers that nobody knows.
class Text { constructor(s) { this._s = s; } get lines() { const m = this._s.match(/\n/g); return m ? m.length : 0; } }
globalThis[["Te", "xt"].join("")] = Text;
const given = [...subjects, new String("a\nb\n"), { match: r => ({ length: r.source + r.flags + r.lastIndex }) }, { match() { return null; } }];
for (let i = 0; i < 2; i++)
    console.log(given.map(s => new globalThis.Text(s).lines).join());
for (const s of [1, null, undefined])
    try { console.log(new globalThis.Text(s).lines); } catch (e) { console.log(e.constructor.name); }
// Substrings of one text, forwards and backwards, under two patterns, with collections in the middle.
const lineOf = index => { const m = lines.substring(0, index).match(/\n/g); return m ? m.length : 0; };
const marks = (from, index) => (lines.substring(from, index).match(/;/g) || []).length;
let total = 0;
for (let i = 0; i < 400; i++) {
    total = (total * 31 + lineOf((i * 37) % lines.length) + lineOf((i * 11) % 90) * 3 + marks(i % 7, (i * 53) % lines.length) * 5 + marks(0, i)) | 0;
    if (i % 100 === 50) Bun.gc(true);
}
console.log(total, lineOf(0), lineOf(lines.length), lineOf(20), RegExp.leftContext.length, lineOf(1), lineOf(41), RegExp.leftContext.length, marks(5, 30), RegExp.leftContext.length);
