// the same end test is asked again where the first has passed, where it has failed, of another string, with another text, by another method, and of a variable that was stored into between the two
function same(s) { if (s.startsWith("--")) return "in:" + s.startsWith("--"); return "out:" + s.startsWith("--"); }
function otherText(s) { if (s.startsWith("--")) return "in:" + s.startsWith("---"); return "out:" + s.startsWith("-"); }
function otherString(s, t) { if (s.endsWith(".ts")) return "in:" + t.endsWith(".ts"); return "out:" + t.endsWith(".ts"); }
function otherMethod(s) { if (s.endsWith("a")) return "in:" + s.startsWith("a"); return "out:" + s.includes("a"); }
function storedBetween(s) { if (s.includes("a")) { s = s.slice(1); return "in:" + s.includes("a"); } return "out"; }
function otherPlace(s) { if (s.startsWith("b", 1)) return "in:" + s.startsWith("b", 0); return "out:" + s.startsWith("b", 1); }
const texts = JSON.parse('["--x", "---", "-", "", "a.ts", "ab", "ba", "aa"]');
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < texts.length; i++)
    console.log(texts[i], same(texts[i]), otherText(texts[i]), otherString(texts[i], texts[(i + 1) % texts.length]), otherMethod(texts[i]), storedBetween(texts[i]), otherPlace(texts[i]));
}
