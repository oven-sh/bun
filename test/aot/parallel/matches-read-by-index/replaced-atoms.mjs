// Every place of a fixed text is replaced: by nothing, a text, a template, in short, long, wide and composed texts.
const unseen = x => [x][JSON.parse("0")];
const replaceAll = (text, re, by) => text.replace(re, by);
const atoms = unseen([/a/g, /ab/g, /'/g, /aa/g, /NQ_VQ/g, /\//g, /é/g, /Ā/g, /ab/, /xyz/g, /\./g, /a b/g]);
const texts = unseen(["", "a", "ab", "abab", "aaa", "aaaa", "x'y'z", "NQ_VQ" + "-".repeat(70) + "NQ_VQNQ_VQ", "/a//b/", "é.é", "Āab", "q".repeat(4100) + "ab" + "q".repeat(33) + "ab", "ab".repeat(90), ("a" + unseen("b") + "c" + unseen("ab")), "--abab--".slice(2, 6), "a ba b"]);
const replacements = unseen(["", "x", "long text", "$&", "$$", "Ā", "a", "é"]);
for (const text of texts) {
  const out = [];
  for (const re of atoms) {
    for (const by of replacements) { re.lastIndex = 3; const made = replaceAll(text, re, by); out.push(made.length + (made.length < 24 ? made : made.slice(-6)) + re.lastIndex); }
    out.push(RegExp.lastMatch, RegExp.leftContext.length);
    out.push(text.replaceAll(re.global ? re : "ab", "-").length);
  }
  console.log(out.join(" "));
}
const marked = Object.defineProperty(/ab/g, "lastIndex", { writable: false, value: 0 });
for (const text of ["abab", "--"]) { try { console.log(replaceAll(text, marked, "")); } catch (error) { console.log(error.constructor.name); } }
