// A Set or a Map of constant strings is looked up in, walked and written to. Each collection is made anew, so none sees what was done to another.
const lines: string[] = [];
function show(label: string, ...values: unknown[]) {
  lines.push(label + ": " + values.map(value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value))).join(" "));
}

const makeWords = () => new Set(["if", "for", "let", "const", "while", "do", "else", "return", "break", "case", "if", ""]);
const makeFew = () => new Set(["a", "b", "c"]);
const makeRanks = () =>
  new Map<string, unknown>([
    ["+", 1],
    ["*", 2],
    ["none", undefined],
    ["null", null],
    ["yes", true],
    ["half", 0.5],
    ["minus", -0],
    ["nan", NaN],
    ["text", "text"],
    ["big", 12345678901234567890n],
    ["+", 3],
  ]);
// prettier-ignore
const makeMany = () => new Set([
  "k0","k1","k2","k3","k4","k5","k6","k7","k8","k9","k10","k11","k12","k13","k14","k15","k16","k17","k18","k19","k20","k21","k22","k23","k24","k25","k26","k27","k28","k29",
  "k30","k31","k32","k33","k34","k35","k36","k37","k38","k39","k40","k41","k42","k43","k44","k45","k46","k47","k48","k49","k50","k51","k52","k53","k54","k55","k56","k57","k58","k59",
  "k60","k61","k62","k63","k64","k65","k66","k67","k68","k69","k70","k71","k72","k73","k74","k75","k76","k77","k78","k79","k80","k81","k82","k83","k84","k85","k86","k87","k88","k89",
  "k90","k91","k92","k93","k94","k95","k96","k97","k98","k99","k100","k101","k102","k103","k104","k105","k106","k107","k108","k109","k110","k111","k112","k113","k114","k115","k116","k117","k118","k119",
  "k120","k121","k122","k123","k124","k125","k126","k127","k128","k129","k130","k131","k132","k133","k134","k135","k136","k137","k138","k139","k140","k141","k142","k143","k144","k145","k146","k147","k148","k149",
  "k150","k151","k152","k153","k154","k155","k156","k157","k158","k159","k160","k161","k162","k163","k164","k165","k166","k167","k168","k169","k170","k171","k172","k173","k174","k175","k176","k177","k178","k179",
  "k180","k181","k182","k183","k184","k185","k186","k187","k188","k189","k190","k191","k192","k193","k194","k195","k196","k197","k198","k199","k200","k201","k202","k203","k204","k205","k206","k207","k208","k209",
  "k210","k211","k212","k213","k214","k215","k216","k217","k218","k219","k220","k221","k222","k223","k224","k225","k226","k227","k228","k229","k230","k231","k232","k233","k234","k235","k236","k237","k238","k239",
  "k240","k241","k242","k243","k244","k245","k246","k247","k248","k249","k250","k251","k252","k253","k254","k255","k256","k257","k258","k259","k260","k261","k262","k263","k264","k265","k266","k267","k268","k269",
]);

const asked: unknown[] = ["if", "iff", "", "case", "ca" + "se".slice(0), "xreturnx".slice(1, 7), 0, -0, NaN, 1.5, undefined, null, true, {}, Symbol("if"), 1n, "k1"];

function lookups() {
  const words = makeWords();
  show("size", words.size, makeFew().size, makeRanks().size, makeMany().size);
  show("has", ...asked.map(key => words.has(key as string)));
  const ranks = makeRanks();
  show("get", ...["+", "*", "none", "null", "yes", "half", "minus", "nan", "text", "big", "absent", ""].map(key => ranks.get(key)));
  show("get of other keys", ...asked.map(key => ranks.get(key as string)));
  show("has none", ranks.has("none"), ranks.get("none"), ranks.has("absent"), ranks.get("absent"));
}

function lookupsInLoops(texts: string[], numbers: number[]) {
  const words = makeWords();
  const many = makeMany();
  const ranks = makeRanks();
  let found = 0;
  let sum = 0;
  for (const text of texts) {
    if (words.has(text)) found++;
    if (many.has(text)) found += 100;
    const rank = ranks.get(text);
    if (typeof rank === "number") sum += rank;
  }
  for (let i = 0; i < 300; i++) {
    if (many.has("k" + i)) found += 10000;
  }
  for (const number of numbers) {
    if ((words as Set<unknown>).has(number)) found = -1;
  }
  show("in loops", found, sum, words.size, many.size);
}

function walks() {
  show("keys", [...makeWords()].join("|"));
  show("entries", [...makeRanks()].map(([key, value]) => key + "=" + String(value)).join("|"));
  const few = makeFew();
  const seen: string[] = [];
  for (const key of few) {
    seen.push(key);
    if (key === "a") few.add("d");
    if (key === "b") few.delete("c");
  }
  show("walk with writes", seen.join(""), [...few].join(""));

  const early = makeFew().values();
  show("first step", early.next().value);
  const held = makeFew();
  const iterator = held.keys();
  held.add("z");
  held.delete("a");
  show("iterator from in front of a write", [...iterator].join(""));

  const cleared = makeFew();
  const overCleared = cleared.values();
  overCleared.next();
  cleared.clear();
  cleared.add("n");
  show("iterator over a clear", [...overCleared].join(""), cleared.size);

  let total = 0;
  makeMany().forEach(key => (total += key.length));
  show("forEach", total);
  show("last of many", [...makeMany()].at(-1), [...makeMany().keys()][255]);
}

function writes() {
  const first = makeWords();
  const second = makeWords();
  first.add("new").add("if");
  show("add", first.size, second.size, first.has("new"), second.has("new"), [...first].at(-1));
  show("delete", first.delete("if"), first.delete("if"), first.delete("absent"), first.has("if"), second.has("if"), first.size);
  show("delete of other keys", ...asked.slice(6).map(key => makeFew().delete(key as string)));
  second.clear();
  show("clear", second.size, second.has("if"), [...second].length);
  second.add("if");
  show("add behind clear", second.size, second.has("if"), second.has("for"));

  const ranks = makeRanks();
  ranks.set("*", "two").set("more", 4);
  show("set", ranks.get("*"), ranks.get("more"), ranks.get("+"), ranks.size, [...ranks.keys()].join("|"));
  (ranks as Map<unknown, unknown>).set(7, "seven");
  show("set of a number", (ranks as Map<unknown, unknown>).get(7), ranks.get("big"), ranks.size);

  const many = makeMany();
  for (let i = 0; i < 270; i += 2) many.delete("k" + i);
  show("half deleted", many.size, many.has("k0"), many.has("k1"), many.has("k269"), [...many][0]);
}

function copies() {
  const words = makeWords();
  const copy = new Set(words);
  copy.delete("if");
  show("copy of a set", words.has("if"), copy.has("if"), copy.size);
  const ranks = makeRanks();
  const other = new Map(ranks);
  other.set("+", 0);
  show("copy of a map", ranks.get("+"), other.get("+"));
}

function otherData() {
  const mixed = new Set([0, -0, NaN, NaN, "0", 1, 1.0, "1", null, undefined, true, 1n, 1n]);
  show("mixed", mixed.size, [...mixed].map(key => typeof key).join("|"), Object.is([...mixed][0], 0));
  const make = () =>
    new Map<string, { n: number } | number[]>([
      ["object", { n: 1 }],
      ["list", [1, 2]],
    ]);
  const one = make();
  const two = make();
  (one.get("object") as { n: number }).n = 5;
  (one.get("list") as number[]).push(3);
  show("objects", JSON.stringify([...one]), JSON.stringify([...two]), one.get("object") === one.get("object"), one.get("object") === two.get("object"));
  const byList = new Map<unknown, string>([
    [[1], "list"],
    [{}, "object"],
  ]);
  show("objects as keys", byList.size, byList.has([1] as unknown), [...byList.values()].join("|"));

  class Tags extends Set<string> {
    override has(key: string) {
      return super.has(key.toLowerCase());
    }
  }
  const tags = new Tags(["a", "b"]);
  show("class below Set", tags.has("A"), tags.has("c"), tags.size, tags instanceof Tags);
  new Set(["nobody", "names", "this"]);
  new Map([["nor", "this"]]);
}

lookups();
for (let run = 0; run < 3; run++) lookupsInLoops(["if", "k7", "+", "nope", "", "half", "k" + (260 + run), "do"], [0, 1, 2.5, NaN]);
walks();
writes();
copies();
otherData();
console.log(lines.join("\n"));
