let word = "";
let part = "ab";
for (let k = 1; k <= 30; k++) { word = word + part; if (k < 30) part = part + part; }
function fill(bound) {
  const out = [];
  for (let at = 0; at < bound; at++) out[at] = word + at;
  return out.length;
}
let said = "none";
try { fill(150000000); } catch (e) { said = e.name; }
console.log(said, word.length, process.memoryUsage().rss > 800000000);
