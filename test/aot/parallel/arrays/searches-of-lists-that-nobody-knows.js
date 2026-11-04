// indexOf and includes on lists of which the build knows nothing, for every kind of value that is sought and every kind of element that is passed over on the way.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const made = text => text.split("|").join("");
const rope = (a, b) => unknown(a) + unknown(b);
const wide = "ЖЖЖ";
const object = {}, symbol = Symbol("s"), other = Symbol("s");
const lists = {
  empty: [],
  texts: ["alpha", "beta", "gamma", "delta", "omega"],
  "texts of one length": ["aaaa", "aaab", "abaa", "baaa", "aaaa"],
  "texts made at run time": ["al|pha", "be|ta", "gam|ma"].map(made),
  "a rope among texts": ["alpha", rope("be", "ta-and-a-good-deal-more-than-that"), "gamma"],
  "wide and narrow": ["abc", wide, "Жbc", "abЖ", made("Ж|ЖЖ")],
  "long texts": ["x".repeat(40) + "a", "x".repeat(40) + "b", "y" + "x".repeat(40)],
  integers: [3, 1, 2, -1, 0],
  numbers: [1.5, NaN, -0, 2],
  "integers and texts": [1, "1", 2, "2", "alpha"],
  holes: [, "alpha", , 1, undefined],
  "all kinds": [null, undefined, true, false, object, symbol, 10n, "", 0, "alpha", [], () => 1],
  "thirty-two": Array.from({ length: 32 }, (_, i) => "t" + i),
  "thirty-three": Array.from({ length: 33 }, (_, i) => "t" + i),
  "cut short": (() => { const list = ["a", "b", "c", "d"]; list.length = 2; return list; })(),
  "grown": (() => { const list = ["a", "b"]; list.length = 4; return list; })(),
};
const sought = {
  alpha: "alpha", "alpha made": made("al|pha"), "alpha as a rope": rope("al", "pha"), omega: "omega", aaaa: "aaaa", baaa: made("ba|aa"), aaac: "aaac", "the rope": rope("be", "ta-and-a-good-deal-more-than-that"),
  wide, "wide made": made("ЖЖ|Ж"), "half wide": "abЖ", abc: "abc", "long b": "x".repeat(40) + "b", "long c": "x".repeat(40) + "c", "empty text": "", t31: "t31", t32: made("t|32"), c: "c",
  1: 1, "text 1": "1", 0: 0, "-0": -0, "-1": -1, 1.5: 1.5, NaN, undefined, null: null, true: true, false: false, object, "another object": {}, symbol, "another symbol": other, "10n": 10n,
};
for (const [name, written] of Object.entries(lists)) {
  const list = unknown(written);
  const answers = [];
  for (const [label, value] of Object.entries(sought)) {
    const index = list.indexOf(value), has = list.includes(value);
    if (index !== -1 || has) answers.push(label + " " + index + " " + has);
  }
  console.log(name + ": " + answers.join(" . "));
}
