// Patterns made at run time of the form ^(?:one|two|three)$, and forms that only look like it, over 8-bit and 16-bit subjects, with every flag and from every lastIndex
const made = text => text + String(Date.now()).slice(99);
const keywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super";
const lists = [
  keywords.replace(/ /g, "|"),
  "a",
  "a|b",
  "a|a|a",
  "ab|abc|abcd|a",
  "abcd|abc|ab|a",
  "do|dodo|dododo",
  "aXa|aYa|aZa|bXa",
  "é|è|ée",
  "一|一二|二一|ab一",
  "\\u4e00\\u4e8c|x\\u00e9",
  "\\$|\\.|\\(\\)|\\\\",
  "a b|a  b| ",
  "\\n|a\\n|\\na",
  "|a",
  "a|",
  "a||b",
  "",
  "a|[bc]|d",
  "a|b+|c",
  "a|b?",
  "a|(?:b|c)d",
  "a|(b)",
  "a|.",
  "\\ud83d\\ude00|\\ud83d|\\ude00",
  "\u{1f600}|a",
  Array.from({ length: 300 }, (_, index) => "w" + index.toString(36)).join("|"),
];
const shapes = [list => `^(?:${list})$`, list => `^(${list})$`, list => `^(?:${list})`, list => `(?:${list})$`, list => `^(?:${list})$|^zz$`, list => `^(?:${list}){2}$`, list => `^(?:${list})?$`, list => `^(?<word>${list})$`, list => `(?:^(?:${list})$)`, list => `^(?i:${list})$`, list => `(?m:^)(?:${list})$`];
const subjects = [
  "", "a", "b", "c", "d", "A", "aa", "ab", "abc", "abcd", "abcde", "bd", "cd", "bb", "do", "dodo", "dododo", "dod", "aXa", "aYa", "bXa", "bYa", "a\n", "\na", "\n", "a\nb", "a b", "a  b", " ", "$", ".", "()", "\\",
  "é", "è", "ée", "éé", "一", "一二", "二一", "ab一", "一ab", "xé", "😀", "\ud83d", "\ude00", "w0", "w8b", "w8c", "w", "zz",
  ...keywords.split(" "), "thi", "thiss", "This", "instanceo", "instanceoff", "functiom", "gunction", "pos", "type", "value", "constructor", "__proto__",
];
const wide = text => (text + "一").slice(0, text.length);
const flagSets = ["", "g", "y", "i", "m", "s", "u", "v", "d", "gy", "gi", "mu"];
let total = 0;
for (const list of lists) {
  for (const shape of shapes) {
    let line = "";
    for (const flags of flagSets) {
      let pattern;
      try {
        pattern = new RegExp(made(shape(list)), flags);
      } catch (error) {
        line += ` ${flags}:${error.name}`;
        continue;
      }
      let sum = 0;
      const add = number => void (sum = (sum * 33 + number) | 0);
      for (const text of subjects) {
        for (const subject of [made(text), wide(made(text)), made("<" + text + ">").slice(1, -1), wide(made("<" + text + ">")).slice(1, -1)]) {
          for (const from of pattern.global || pattern.sticky ? [0, 1, subject.length, subject.length + 1] : [0]) {
            pattern.lastIndex = from;
            add(pattern.test(subject) ? 1 : 0);
            add(pattern.lastIndex);
            pattern.lastIndex = from;
            const match = pattern.exec(subject);
            add(match ? match.index * 7 + match[0].length * 3 + match.length + (match[1] === undefined ? 0 : match[1].length) : -1);
            add(pattern.lastIndex);
            total++;
          }
          pattern.lastIndex = 0;
          add(subject.search(pattern));
          add(subject.replace(pattern, "<$&>").length);
          add(subject.split(pattern).length);
          add((subject.match(pattern) ?? []).length);
        }
      }
      line += ` ${flags}:${(sum >>> 0).toString(36)}`;
    }
    console.log(JSON.stringify(shape(list).slice(0, 40)) + line);
  }
}
console.log(total);
