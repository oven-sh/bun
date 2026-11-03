// text.split(separator) and text.replaceAll(sought, replacement) with a text to look for of one to a hundred characters: repeated, overlapping, at either end, absent, 8 and 16 bits a character on either side, in flat texts, ropes and pieces of texts.
const lines = [];
let hash = 0; const mix = text => { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; };
const flat = text => text.length && /^[\x00-\xff]*$/.test(text) ? Buffer.from(text, "latin1").toString("latin1") : (" " + text).slice(1);
function cut(text, separator) { return text.split(separator); }
function cutAtMost(text, separator, limit) { return text.split(separator, limit); }
function put(text, sought, replacement) { return text.replaceAll(sought, replacement); }
const show = pieces => pieces.length + ":" + pieces.map(piece => JSON.stringify(piece)).join();
const soughts = ["a", "ab", "aa", "aaa", "aba", "abab", ", ", "\n", "\r\n", "--", "<x></x>", "é", "éa", "日", "日本", "a日", "needle in a haystack", "x".repeat(8), "xy".repeat(20), "abcdefghij".repeat(10)];
const around = ["", "a", "b", "ab", "ba", "aab", "é", "日", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "the quick brown fox "];
for (const sought of soughts) {
  const before = hash;
  for (const left of around) for (const middle of around) for (const right of around) {
    for (const subject of [left + sought + middle + sought + right, left + sought + sought + right, left + sought.slice(0, -1) + middle + sought + right, left + middle + right, sought.slice(1) + left + sought]) {
      for (const text of [flat(subject), subject, ("#" + flat(subject) + "#").slice(1, -1)]) { mix(show(cut(text, sought))); mix(put(text, sought, "[]")); mix(put(text, sought, "")); mix(put(text, sought, sought + sought)); }
    }
  }
  lines.push(JSON.stringify(sought.slice(0, 12)) + sought.length + " " + (hash - before | 0));
}
for (const limit of [0, 1, 2, 3, 100, -1, 2 ** 32, 2 ** 32 + 1, 1.9, NaN, undefined]) lines.push("limit " + limit + " " + show(cutAtMost(flat("a, b, c, d"), ", ", limit)) + " " + show(cutAtMost(flat("abcabcabc"), "bc", limit)));
lines.push(show(cut("", "ab")), show(cut("ab", "ab")), show(cut("abab", "ab")), show(cut("ab", "abc")), show(cut(flat("aaaa"), "aa")), show(cut(flat("aaaaa"), "aa")), put(flat("aaaaa"), "aa", "b"), put(flat("abababa"), "aba", "x"), put("", "ab", "x"), put(flat("a$b"), "$b", "$&$&"), put(flat("a.b.c"), ".b", "$`|$'"), put(flat("xx--xx"), "--", "$$"));
const page = flat(('<tr class="row"><td>1</td><td><a href="/x">name</a></td></tr>\n').repeat(300) + "<page-body-goes-here></page-body-goes-here>" + '<script src="/a.js"></script>\n'.repeat(20));
lines.push(cut(page, "<page-body-goes-here></page-body-goes-here>").map(piece => piece.length).join(), cut(page, "</tr>\n").length, cut(page, '<td><a href="/x">name</a></td>').length, cut(page, "<page-body-goes-here></page-body-goes-there>").length, put(page, "<page-body-goes-here></page-body-goes-here>", "<main></main>").length, put(page, "</td><td>", "|").length, cut(page + "日", "</tr>\n").length, cut(page, "</tr>\n日").length);
let seed = 4242; const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8;
for (let round = 0; round < 4000; round++) { const letters = ["ab", "abc", "aé", "ab日"][next() % 4]; let subject = "", sought = ""; for (let i = next() % 120; i > 0; i--) subject += letters[next() % letters.length]; for (let i = 1 + next() % 6; i > 0; i--) sought += letters[next() % letters.length]; const pieces = cut(flat(subject), flat(sought)); mix(show(pieces)); if (pieces.join(sought) !== subject) lines.push("does not join back: " + JSON.stringify([subject, sought])); mix(put(flat(subject), flat(sought), "-")); }
lines.push("random " + hash);
console.log(lines.join("\n"));
