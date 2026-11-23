// join() of strings of two parts: both flat, nested, slices, of two bytes a character, beside flat strings, numbers and objects, with separators of every length.
const base = "the quick brown fox jumps over the lazy dog", wide = "zażółć gęślą jaźń \u{1F600}";
function parts(n, form) { return Array.from({ length: n }, (_, i) => form(i)); }
const forms = [i => "word" + i, i => base.slice(i % 9, i % 9 + 12) + i, i => "a" + i + "b" + i, i => ("x" + i) + ("y" + i), i => wide + i, i => i + wide.slice(2, 5), i => "é" + i, i => base.slice(i % 20), i => i % 3 ? "w" + i : i, i => i % 5 ? "w" + i : null, i => i % 7 ? "long".repeat(i % 11) + i : "", i => "n" + (i + 0.5), i => String(i) + String(i + 1) + wide[i % 5], i => i % 4 ? "w" + i : { toString: () => "o" + i }, i => i % 2 ? "ab" : "a" + i];
const separators = [undefined, "", ",", " ", ", ", "é", "ł", " -> ", "\u{1F600}", "se" + "p".repeat(3)];
function joined(list, separator) { return separator === undefined ? list.join() : list.join(separator); }
const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
for (const form of forms) for (const n of [0, 1, 2, 17, 33, 50, 200]) {
  const line = [];
  for (const separator of separators) { const list = parts(n, form); const first = joined(list, separator), again = joined(list, separator); line.push(first.length, hash(first), first === again, list.length && list[0] === form(0)); }
  console.log(line.join(" "));
}
console.log(parts(20, forms[0]).join(" "), parts(18, forms[4]).join("|"), parts(18, forms[3]).join(""));
function rows(n) { let out = ""; for (let k = 0; k < n; k++) { const cells = []; for (let c = 0; c < 40; c++) cells.push("c" + (k * c % 97)); out += cells.join(";") + "\n"; } return hash(out) + " " + out.length; }
console.log(rows(50));
