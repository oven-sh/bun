// split, replaceAll, replace, indexOf, includes, lastIndexOf of texts of many lengths, with the sought text at every place that matters
var seed = 1;
function rnd(n) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; }
function text(n, alphabet, wide) { var s = ""; for (var i = 0; i < n; i++) s += alphabet[rnd(alphabet.length)]; if (wide && n) { var p = rnd(n); s = s.slice(0, p) + "Ж" + s.slice(p + 1); } return s; }
var digest = 0, lines = [];
function add(v) { var s = typeof v === "object" ? v.length + ":" + v.join("|").length + ":" + (v[0] || "").slice(0, 8) + (v[v.length - 1] || "").slice(-8) : String(v); for (var i = 0; i < s.length; i++) digest = (Math.imul(digest, 31) + s.charCodeAt(i)) | 0; }
var alphabets = ["ab", "abc", "abcdefgh", "#include<>fogVertexDeclaration\n ", "aaab"];
for (var round = 0; round < 400; round++) {
  var alphabet = alphabets[rnd(alphabets.length)], size = [0, 1, 5, 63, 64, 65, 255, 256, 257, 300, 319, 320, 321, 383, 400, 512, 700, 1000, 2048, 5000][rnd(20)];
  var wide = rnd(6) === 0, hay = text(size, alphabet, wide), length = [1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 25, 31, 32, 33, 63, 64, 65, 100][rnd(18)], needle;
  switch (rnd(5)) {
    case 0: needle = text(length, alphabet, rnd(9) === 0); break;
    case 1: var p = rnd(Math.max(1, size - length)); needle = hay.slice(p, p + length); break;
    case 2: needle = hay.slice(-length); break;
    case 3: needle = hay.slice(0, length); break;
    default: var at = rnd(size + 1); needle = text(length, "xyz", false); hay = hay.slice(0, at) + needle + hay.slice(at); if (rnd(2)) hay += needle;
  }
  if (rnd(3) === 0) { var half = rnd(hay.length + 1); hay = [hay.slice(0, half), hay.slice(half)].join(""); }
  var rope = rnd(3) === 0 ? hay + text(rnd(40), alphabet) : hay;
  add(rope.indexOf(needle)); add(rope.includes(needle)); add(rope.lastIndexOf(needle));
  for (var k = 0; k < 4; k++) { var start = [0, 1, size >> 1, size - length, size, size + 3, -2, rnd(size + 1)][rnd(8)]; add(rope.indexOf(needle, start)); add(rope.includes(needle, start)); add(rope.startsWith(needle, start)); }
  if (needle) { add(rope.split(needle)); add(rope.split(needle, rnd(5))); add(rope.replaceAll(needle, "<" + round + ">").length); add(rope.replace(needle, "$&!$`".slice(0, rnd(6)))); add(rope.replaceAll(needle, m => m.length + "").length); }
  if (round % 100 === 99) lines.push(round + " " + digest);
}
var long = "ab".repeat(20000), found = 0;
for (var j = 0; j < 20; j++) { found += long.indexOf("ab".repeat(50) + "c"); found += (long + "c").indexOf("ba".repeat(60) + "bc"); found += (long + "ac").split("ab".repeat(10) + "ac").length; }
lines.push(String(found));
console.log(lines.join("\n"));
