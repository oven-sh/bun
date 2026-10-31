// `(?=([a-z]*))\1`, made at run time: a lookahead takes a run into a group and a reference reads it again, so the run gives nothing back. Beside it, spellings that look alike and mean something else.
const made = text => text + String(Date.now()).slice(99);
const sources = [
  // The idiom.
  "(?=([a-z]*))\\1", "(?=([a-z]*))(?:\\1)", "(?=([a-z]*))(?:(?:\\1))", "(?=([a-z]+))\\1", "(?=([a-z]{2,}))\\1", "(?=(a*))\\1", "(?=(a+))\\1a", "(?=([a-z]*))\\1z", "(?=([a-z]*))\\1[0-9]",
  "x(?=([a-z]*))\\1y", "x(?=([a-z]*))\\1(?=([0-9]*))\\2y", "<(?=([^a-z<>/]*))(?:\\1)/(?=([^a-z<>]*))(?:\\2)e(?=([\\u200b\\u{e0000}-\\u{e0fff}]*))(?:\\3)n(?:[^a-z]|$)",
  "(?=([^a-z]*))\\1", "(?=([\\u4e00-\\u9fff]*))\\1", "(?=([\\u{1d200}-\\u{1d2ff}]*))\\1", "(?=([^\\u{1d200}-\\u{1d2ff}]*))\\1", "(?=(.*))\\1", "(?=(.*))\\1x", "(?=([\\s\\S]*))\\1", "(?=(\\w*))\\1\\b", "(?=(\\d+))\\1(?!\\.)",
  // In groups, loops, alternatives and lookarounds.
  "(?:(?=([a-z]*))\\1)", "((?=([a-z]*))\\2)", "(?:(?=([a-z]*))\\1,)*", "(?:(?=([a-z]*))\\1,)+$", "(?:(?=([a-z]+))\\1|[0-9])*", "(?:(?=([a-z]*))\\1)*x", "(?:(?=([a-z]*))\\1){2}", "(?:(?=([a-z]+))\\1[0-9]){1,3}",
  "(?:(?=([a-z]*))\\1z|(?=([a-z]*))\\2y|a)", "(?:a(?=([a-z]*))\\1z|ab)", "(?=(?=([a-z]*))\\1[0-9])", "(?!(?=([a-z]*))\\1[0-9])[a-z]", "(?<=x)(?=([a-z]*))\\1", "(?<=(?=([a-z]*))\\1)y", "(?=([a-z]*))\\1(?<=b)",
  "^(?=([a-z]*))\\1$", "^(?:(?=([a-z]*))\\1 ?)+$", "(?=([a-z]*))\\1\\1", "(?=([a-z]*))\\1x\\1", "(?=([a-z]*))\\1(?=([a-z]*))\\2", "(a)?(?=([a-z]*))\\2\\1", "(?<run>x)?(?=(?<word>[a-z]*))\\k<word>",
  // Spellings that look alike.
  "(?=([a-z]*?))\\1", "(?=([a-z]*))\\1?", "(?=([a-z]*))\\1*", "(?=([a-z]*))\\1{2}", "(?=([a-z]*))\\1+", "(?=([a-z]*)z)\\1", "(?=([a-z]*))x\\1", "(?=([a-z]*))(\\1)", "(?=(?:[a-z]*))", "(?!([a-z]*))\\1", "(?=([a-z]*)|x)\\1",
  "(?=([a-z]*))\\2([0-9])", "([0-9])(?=([a-z]*))\\1", "(?=([a-z]*[0-9]))\\1", "(?=([a-z][0-9]*))\\1", "(?=([a-z]{0,2}))\\1", "(?=([a-z]{2}))\\1", "(?=(([a-z]*)))\\1", "(?=(([a-z]*)))\\2", "(?=([a-z]*)){2}\\1", "(?=([a-z]|[0-9])*)\\1",
  "(?=([a-z]*))(?:\\1|x)", "(?=([a-z]*))(?:\\1)?", "(?=([a-z]*))(?:\\1x)", "(?=()[a-z]*)\\1", "(?=([a-z]*))(?=\\1)", "(?<=([a-z]*))\\1",
];
const flagSets = ["", "g", "i", "u", "iu", "giu", "y", "m", "s", "v", "gy", "d"];
const pieces = ["", "a", "ab", "abz", "ABZ", "abc1", "z", "y", "x", "xabcy", "xab12y", "1", "12.", "a,b,c,", "ab cd ef", "</en>", "< /en>", "<一/en>", "<\u{1d236}/en>", "</en\u{1d237}", "<​/​e\u{e0041}n ", "一丁a",
  "\u{1d236}\u{1d237}", "\ud834", "\udc00a", "a\ud834", "\ud834𝄶", "KK", "sſ", "\n", "ab\ncd", "ﷺab"];
const subjects = [];
for (const first of pieces) for (const second of ["", "a", "Z9", "\u{1d236}", "<"]) subjects.push(made(first + second));
subjects.push(made("ab".repeat(40)), made("ab".repeat(40) + "1"), made("\u{1d236}".repeat(40) + "x"), made("a,".repeat(30) + "!"));
const seen = value => (value === undefined ? "-" : typeof value !== "string" ? "#" : value.length + ":" + (value.codePointAt(0) ?? 0));
for (const source of sources) {
  let line = "";
  for (const flags of flagSets) {
    let pattern;
    try {
      pattern = new RegExp(made(source), flags);
    } catch (error) {
      line += ` ${flags}:${error.name}`;
      continue;
    }
    const moves = pattern.global || pattern.sticky;
    let sum = 0;
    const add = number => void (sum = (sum * 33 + number) | 0);
    const addText = text => { for (let i = 0; i < text.length; i++) add(text.charCodeAt(i)); };
    for (const subject of subjects) {
      for (const from of moves ? [0, 1, 2, subject.length] : [0]) {
        pattern.lastIndex = from;
        const match = pattern.exec(subject);
        add(pattern.lastIndex);
        if (!match) { add(-1); continue; }
        add(match.index);
        addText(match.map(seen).join());
        if (match.groups) addText(Object.entries(match.groups).map(([name, value]) => name + seen(value)).join());
        if (match.indices) addText(match.indices.map(pair => (pair ? pair.join("-") : "-")).join());
        pattern.lastIndex = from;
        if (!pattern.test(subject)) add(-2);
      }
      pattern.lastIndex = 0;
      addText(subject.replace(pattern, "[$&|$1|$2]"));
      pattern.lastIndex = 0;
      addText(subject.replace(pattern, (...found) => "{" + found.map(seen).join() + "}"));
      pattern.lastIndex = 0;
      add(subject.search(pattern));
      addText(subject.split(pattern).map(seen).join());
      pattern.lastIndex = 0;
      if (pattern.global) for (const match of subject.matchAll(pattern)) addText(match.index + match.map(seen).join());
      pattern.lastIndex = 0;
      addText((subject.match(pattern) ?? []).map(seen).join());
    }
    line += ` ${flags}:${(sum >>> 0).toString(36)}`;
  }
  console.log(source + line);
}
