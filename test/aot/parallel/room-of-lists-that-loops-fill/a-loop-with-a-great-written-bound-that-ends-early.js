function fill() {
  const out = [];
  for (let at = 0; at < 150000000; at++) {
    text = text + text;
    out.push(at);
  }
  return out.length;
}
let text = "ab";
let said = "none";
try { fill(); } catch (e) { said = e.name; }
console.log(said, process.memoryUsage().rss > 800000000);
