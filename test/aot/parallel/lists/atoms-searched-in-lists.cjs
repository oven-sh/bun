// list.indexOf(text), includes, lastIndexOf: atoms and texts that are none, the same and other texts, of eight and sixteen bits, beside values of other kinds.
const table = {}, atoms = [], texts = [], ropes = [], slices = [];
const spelled = ["", "a", "b", "ab", "abc", "abd", "abcdefgh", "abcdefgi", "été", "中文", "中斈", "x".repeat(40), "x".repeat(39) + "y", "0", "12", "length"];
for (const s of spelled) {
  const name = s.split("").join(""); table[name] = 1; let found = name; for (const key in table) if (key === name) found = key; atoms.push(found);
  texts.push(Array.from(s).map(c => c).join("")); ropes.push(s.slice(0, s.length >> 1) + s.slice(s.length >> 1)); slices.push(("<" + s + ">" + s).slice(1, 1 + s.length));
}
const wide = spelled.map(s => ("中" + s).slice(1));
const other = [undefined, null, 0, -0, NaN, 1.5, true, 10n, Symbol.iterator, {}, []];
function at(list, value) { return list.indexOf(value); }
function has(list, value) { return list.includes(value) ? 1 : 0; }
function last(list, value) { return list.lastIndexOf(value); }
function behind(list, value, from) { return list.indexOf(value, from); }
const mixed = []; for (let k = 0; k < atoms.length; k++) mixed.push(k % 4 === 0 ? atoms[k] : k % 4 === 1 ? texts[k] : k % 4 === 2 ? ropes[k] + "" : slices[k], other[k % other.length]);
const holes = [, "a", , atoms[4], , texts[12]], twice = atoms.concat(texts), only = texts.slice(), reversed = atoms.slice().reverse(), bare = atoms.filter(a => a.length > 2);
const lists = [atoms, texts, ropes, slices, wide, mixed, holes, twice, only, reversed, bare, other, [], [atoms[3]], [texts[3]], [1, 2, 3], [0.5, NaN], new Array(5)];
const asked = [...atoms, ...texts, ...ropes, ...slices, ...wide, ...other, "absent", "abcdefg" + "h", "a" + spelled.length, 2, NaN, "abd"];
let hash = 7; const lines = [];
for (let round = 0; round < 30; round++) for (const list of lists) { const line = []; for (const value of asked) { const p = at(list, value), q = has(list, value), r = last(list, value), s = behind(list, value, round % 7 - 3); line.push(p, q, r, s); hash = (hash * 31 + p * 7 + q * 3 + r + s * 5) | 0; } if (round === 0 || round === 29) lines.push(line.join()); }
function count(names, n) { let sum = 0; for (let i = 0; i < n; i++) { const name = names[i % names.length]; if (table[name]) sum += atoms.indexOf(name); else sum -= reversed.indexOf(name); sum += reversed.includes(name) ? 1000 : 0; } return sum; }
lines.push(count(atoms, 500), count(texts, 500), count(ropes, 500), count(wide, 500), count(["q", "r", "ab", "abce"], 500));
const growing = []; for (let i = 0; i < 400; i++) { const name = atoms[(i * 7) % atoms.length]; if (growing.indexOf(name) < 0) growing.push(name); else if (i % 50 === 49) growing.length = 3; } lines.push(growing.join("|"));
console.log(lines.join("\n")); console.log(hash);
