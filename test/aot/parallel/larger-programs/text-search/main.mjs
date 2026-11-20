// Searching texts: five ways to find a word, many words at once, suffix arrays, wild cards, edit distance, an index with ranks, highlights, in two modules
import { Pattern, Naive, Prefixes, Skips, Rolling, Masks, TrieNode, ManyWords, SuffixArray, wild, Speller, Index } from "./lib.mjs";
const base = "the quick brown fox jumps over the lazy dog and the cat sat on a mat while it rained all day in spain ";
let text = "";
for (let i = 0; i < 120; i++) text += base.slice((i * 13) % 60) + "word" + (i % 17) + " abracadabra aaaaab ";
const patterns = ["the", "abra", "aaaab", "word1", "zzz", "cat sat on a mat while it ra", "a"];
for (const p of patterns) {
  const row = [Naive, Prefixes, Skips, Rolling, Masks].map(K => {
    const k = new K(p);
    const at = [...k.find(text)];
    return `${k.name}:${at.length}:${at.reduce((a, b) => (a + b) % 100003, 0)}:${k.compared}`;
});
  console.log(p, row.join(" "), [...text.matchAll(new RegExp("(?=" + p + ")", "g"))].length);
}
let sum = 0;
for (let round = 0; round < 60; round++) for (const K of [Naive, Prefixes, Skips, Rolling,
  Masks]) sum += new K(patterns[round % 7]).count(text);
console.log(sum);
const many = new ManyWords(["he", "she", "his", "hers", "abra", "cad", "a", "word1", "word12",
  "é😀"]);
console.log([...many.scan("ushers and his é😀 word123 abracadabra")].map(f => f.word + "@" + f.at).join(" "),
  many.has("hers"), many.has("her"), [...many.starting("h")].join(),
  many.replace("ushers his abracadabra", w => w.toUpperCase()), [...many.scan(text)].length,
  TrieNode === undefined);
const sa = new SuffixArray(text.slice(0, 1800));
console.log(sa.rounds, JSON.stringify(sa.longestRepeat().slice(0, 40)),
  sa.longestRepeat().length, sa.distinct(), patterns.map(p => sa.find(p).length).join(),
  new SuffixArray("banana").order.join(), new SuffixArray("banana").distinct(),
  new SuffixArray("").distinct());
console.log(["*", "a*b?d", "*abra*", "?", "", "a**", "*.txt"].map(p => ["", "a", "abcd",
  "axxbyd", "xabrax", "n.txt"].map(t => (wild(p, t) ? 1 : 0)).join("")).join(" "));
const speller = new Speller(base + " necessary definitely receive separate weather whether friend their there because " + base);
console.log(speller.size,
  speller.correct("The quik brwon fox jmups ovr teh lzay dogg becuase xyzzyq"),
  speller.near("there", 2).slice(0, 5).map(x => x.w + x.d + "/" + x.n).join(), speller.asked);
const index = new Index();
for (let i = 0; i < 200; i++) index.add("doc" + i,
  `${base.split(" ").slice(i % 9, 9 + (i % 8)).join(" ")} number ${i % 23} ${i % 3 ? "jumping cats" : "raining dogs in spain"} ${"fox ".repeat(i % 4)}`);
for (const q of ["fox", "quick fox", '"raining dogs"', "cat -spain", "number 7",
  '"brown fox" jumps', "nothing", "the"]) {
  const r = index.search(q);
  console.log(q, "=>", r.length, r.slice(0,
    2).map(x => `${x.title} ${x.score.toFixed(4)} ${x.text}`).join(" | "));
}
let total = 0;
for (let i = 0; i < 400; i++) total += index.search(["fox", "cat dog", '"lazy dog"',
  "rain -cat"][i % 4], 10).reduce((s, x) => s + Math.round(x.score * 1000) + x.text.length, 0);
console.log(total, index.terms);
for (const bad of [() => new Naive(""), () => new Pattern("x").count("x")]) try {
  bad();
} catch (e) {
  console.log(e.name, e.message);
}
