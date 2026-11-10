function fill(bound) {
  const out = [];
  for (let at = 0; at < bound; at++) {
    text = text + text;
    out[at] = at;
  }
  return out.length;
}
let text = "ab";
let said = "none";
try { fill(150000000); } catch (e) { said = e.name; }
console.log(said, process.memoryUsage().rss > 800000000);
