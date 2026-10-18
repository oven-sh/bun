function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

function make(list: string[]): Set<string> {
  return new Set(list);
}

function joined(a: string, b: string): string {
  return a + b;
}

const letters = "abcdefghijklmnopqrstuvwxyz";

for (let length = 0; length <= 12; length++) {
  say("of " + length, () => {
    const list: string[] = [];
    for (let i = 0; i < length; i++) list.push(letters[i] + ":");
    const set = make(list);
    return [set.size, [...set], set.has("a:"), set.has(letters[length] + ":"), set.has("")];
  });
}
say("the same cell twice", () => {
  const one = "http:";
  return [...make([one, "https:", one, "tel:", one])];
});
say("the same text in other cells", () => [...make([joined("ht", "tp:"), "http:", joined("h", "ttp:"), joined("te", "l:"), "tel:"])]);
say("all the same", () => [...make(["x", "x", "x", "x", "x", "x", "x", "x"])]);
say("ropes", () => {
  const long = "a long text that is surely kept as a rope until somebody asks for its characters";
  const set = make([joined(long, "1"), joined(long, "2"), joined(long, "1")]);
  return [set.size, set.has(long + "1"), set.has(long + "3")];
});
say("parts of a text", () => {
  const text = "alpha,beta,gamma,alpha,delta";
  const set = make(text.split(","));
  return [[...set], set.has("gamma"), set.has("alph")];
});
say("the empty text, and wide ones", () => {
  const set = make(["", "é", "日本", "", "日本", "\u{1F600}"]);
  return [set.size, [...set], set.has(""), set.has("日本"), set.has("日")];
});
say("it grows afterwards", () => {
  const set = make(["a", "b", "c", "d"]);
  for (let i = 0; i < 40; i++) set.add("k" + (i % 20));
  return [set.size, [...set].join(), set.has("k19"), set.has("k20")];
});
say("deleted, added again, cleared", () => {
  const set = make(["a", "b", "c", "d"]);
  const first = [set.delete("b"), set.delete("b"), set.size, [...set]];
  set.add("b");
  const second = [...set];
  set.clear();
  set.add("z");
  return [first, second, [...set]];
});
say("changed while it is walked", () => {
  const set = make(["a", "b", "c"]);
  const seen: string[] = [];
  for (const key of set) {
    seen.push(key);
    if (key === "a") set.delete("b");
    if (key === "c" && seen.length < 6) set.add("x" + seen.length);
  }
  return seen;
});
say("the array is not touched, and changes to it do not reach the set", () => {
  const list = ["a", "b"];
  const set = make(list);
  list.push("c");
  list[0] = "z";
  return [list, [...set]];
});
say("other values take the other way", () => {
  const mixed: any[] = ["a", 1, "a", 1, null, undefined, "1"];
  const holes: any[] = ["a", , "b"];
  return [[...new Set(mixed)], [...new Set(holes)], [...new Set<string>([])], [...new Set("aab")]];
});
say("many, kept", () => {
  const kept: Set<string>[] = [];
  let total = 0;
  for (let i = 0; i < 20000; i++) {
    const set = make(["k" + (i & 3), "k" + (i & 1), "http:", "k" + (i & 7)]);
    total += set.size;
    if (i % 1000 === 0) kept.push(set);
  }
  return [total, kept.map((set) => [...set].join("|"))];
});
