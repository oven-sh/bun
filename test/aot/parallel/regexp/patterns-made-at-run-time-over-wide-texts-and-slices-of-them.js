// Patterns made at run time held against 16-bit texts, slices of 16-bit texts and texts put together, beside the same words in 8 bits: test, exec, search, match, and what RegExp remembers of the last match
const made = text => text + String(Date.now()).slice(99);
const sources = [
  "b+", "^b+$", "(a)(b)?", "[一-三]+", "[^a-z]+", "\\w+", "\\W", "\\s", ".", ".$", "^.", "a.c", "(?:ab|一二)+", "(.)\\1", "(?<first>.)(?<rest>.*)", "\\b一", "一\\b", "(?=一)", "(?!a).", "(?<=一)二", "(?<!一)二",
  "\\ud83d", "\\ude00", "\\ud83d\\ude00", "[\\ud83d]", "[^\\ud83d]", "\\u{1f600}", "[\\u{1f600}-\\u{1f64f}]", "\\p{L}+", "\\p{Emoji}", "^\\S+$", "x*", "", "$", "(a)|(b)|(c)|(d)|(e)|(f)|(g)|(h)|(i)|(j)|(k)|(l)|(m)|(n)|(o)|(p)|(q)|(r)|(s)|(t)",
  "é", "É", "[é-ü]", "ǆ", "ſ", "K", "ß",
];
const flagSets = ["", "i", "u", "v", "iu", "s", "m", "g", "y", "d", "gu"];
const words = ["", "a", "b", "bbb", "abc", "aXc", "ab", "abab", "aa", "t", "é", "É", "ss", "k", "s", "一", "一二", "二", "一二一二", "三一", "a一", "一a", " 一", "一\n二", "😀", "\ud83d", "\ude00", "\ude00\ud83d", "a😀b", "😀😀", "\ud83da", "ǅ", "K", "ẞ"];
const forms = [
  text => made(text),
  text => (made(text) + "一").slice(0, text.length),
  text => made("一" + text + "一").slice(1, 1 + text.length),
  text => made("<" + text + ">").slice(1, 1 + text.length),
  text => made(text.slice(0, text.length >> 1)) + made(text.slice(text.length >> 1)),
  text => made("一" + text).slice(1) + made(""),
];
let total = 0;
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
    let sum = 0;
    const add = number => void (sum = (sum * 33 + number) | 0);
    const addText = text => {
      add(text === undefined ? -7 : text.length);
      for (let index = 0; text !== undefined && index < text.length; index++) add(text.charCodeAt(index));
    };
    for (const word of words) {
      for (const form of forms) {
        for (const from of pattern.global || pattern.sticky ? [0, 1, word.length] : [0]) {
          pattern.lastIndex = from;
          add(pattern.test(form(word)) ? 1 : 0);
          add(pattern.lastIndex);
          addText(RegExp.lastMatch);
          addText(RegExp.$1);
          addText(RegExp.leftContext);
          pattern.lastIndex = from;
          const match = pattern.exec(form(word));
          add(pattern.lastIndex);
          add(match ? match.index : -1);
          for (const part of match ?? []) addText(part);
          if (match?.groups) addText(match.groups.rest);
          if (match?.indices) add(match.indices[0][1]);
          addText(RegExp.input);
          total++;
        }
        pattern.lastIndex = 0;
        add(form(word).search(pattern));
        for (const part of form(word).match(pattern) ?? []) addText(part);
        addText(form(word).replace(pattern, "[$&]"));
      }
    }
    line += ` ${flags}:${(sum >>> 0).toString(36)}`;
  }
  console.log(JSON.stringify(source.slice(0, 30)) + line);
}
console.log(total);
