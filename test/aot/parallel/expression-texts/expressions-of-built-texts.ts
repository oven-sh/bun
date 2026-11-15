// Expressions whose texts are built when the file is loaded: repeat(), padStart(), padEnd(), substr(), codePointAt(), concat(), flat(), findLast(), lastIndexOf(), toString() of an expression, Array.from({ length }, mapper), new Array(n).fill(), Array(n).
const HEX = "[0-9a-f]";
const all: Record<string, RegExp> = {
  repeated: new RegExp("^" + HEX.repeat(8) + "-" + (HEX.repeat(4) + "-").repeat(3) + HEX.repeat(12) + "$"),
  repeatedOnce: new RegExp("x".repeat(1) + "y".repeat(0) + "z{2}".repeat(2)),
  padded: new RegExp("a".padEnd(4, "bc") + "|" + "d".padStart(5, "_") + "|" + "long".padEnd(2, "x")),
  hex: new RegExp([0x41, 0x7a].map(c => "\\u" + c.toString(16).padStart(4, "0")).join("|")),
  sub: new RegExp("abcdef".substr(1, 3) + "abcdef".substr(-2) + "q".concat("r", "s")),
  points: new RegExp(["é", "a"].map(c => "\\u" + c.codePointAt(0)!.toString(16).padStart(4, "0")).join("")),
  flat: new RegExp([["a", "b"], ["c"], []].flat().join("|")),
  deep: new RegExp([["a", ["b", ["c"]]], "d"].flat(Infinity as 1).join("")),
  source: new RegExp(/a+(b|c)?/.toString().slice(1, -1), "g"),
  flags: new RegExp(/[x/y]/gi.toString().replace(/^\//, "").replace(/\/[a-z]*$/, "")),
  fromLength: new RegExp(Array.from({ length: 4 }, (_, i) => "n" + i).join("|")),
  fromLengthOnly: new RegExp(Array.from({ length: 3 }).map((_, i) => i * 2).join("-")),
  fromList: new RegExp(Array.from(["p", "q"], (x, i) => x + i).join("|")),
  filled: new RegExp(new Array(3).fill("[0-9]").join(":")),
  filledCall: new RegExp(Array(4).fill("\\d").join("\\.")),
  filledMap: new RegExp(Array(3).fill(0).map((_, i) => String.fromCharCode(97 + i)).join("+") + "+"),
  last: new RegExp(["aa", "b", "cc"].findLast(x => x.length === 2)! + ["a", "b", "a"].lastIndexOf("a")),
};
const texts = ["0123abcd-0123-0123-0123-0123456789ab", "xz{2}zz", "abcb ____d long", "A z", "bcdefqrs", "éa", "c b a", "abcd", "aab ac", "x/Y", "n0 n3 n4", "0-2-4", "p0 q1", "1:2:3", "1.2.3.4", "aabbcc", "cc2"];
for (const [name, re] of Object.entries(all)) console.log(name, String(re), texts.map(t => (t.match(re) ?? [""])[0]!.length).join(), texts.map(t => re.test(t) ? 1 : 0).join(""));
function build(n: number, word: string): string {
  const out: string[] = [];
  for (const make of [() => word.repeat(n), () => word.padStart(n, "ab"), () => Array.from({ length: n }, (_, i) => word + i).join("|"), () => new Array(n).fill(word).join("|"), () => [[word], [n]].flat().join("")]) {
    try { out.push(String(new RegExp(make()).test(word + word + "0")) + make().length); } catch (e) { out.push((e as Error).name); }
  }
  return out.join();
}
for (const n of [0, 1, 2, 3, 10, -1, 1.5, NaN]) console.log(n, build(n, "w"));
for (const make of [() => new Array(-1 as number).fill("x"), () => Array.from({ length: -2 }, () => "y"), () => "x".repeat(-1), () => Array.from({ length: "3" as any }, (_, i) => i), () => Array.from({ length: 2.7 }, (_, i) => i)]) {
  try { console.log(new RegExp((make() as any[]).toString()).source); } catch (e) { console.log((e as Error).name); }
}
