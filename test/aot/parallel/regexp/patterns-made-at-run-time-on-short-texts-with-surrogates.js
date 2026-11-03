// A pattern in unicode mode takes a lead and a trail surrogate as one character. A text with a surrogate among its first units goes to the matcher that does so at once.
// The patterns are made from texts at run time, so no code was compiled for them. Every pattern is asked about every text, from every place.
const sources = [
  ".",
  "^.$",
  "..",
  "[^a]",
  "[^a]+",
  "[\\u{1d236}]",
  "[\\u{1d200}-\\u{1d2ff}]+",
  "[^\\u{1d200}-\\u{1d2ff}]+",
  "\\ud834",
  "\\udd36",
  "[\\ud834]",
  "[\\udd36]",
  "\\ud834\\udd36",
  "\\p{L}+",
  "\\P{L}+",
  "\\p{So}",
  "\\W",
  "\\w+",
  "\\S+",
  "x.y",
  "x(.)y",
  "(.)\\1",
  "(?=(.))\\1",
  "(?=([^a-z]*))(?:\\1)z",
  "(?<=.)y",
  "(?<=\\u{1d236})y",
  "(?<!\\u{1d236})y",
  "(?<=(.))y",
  "(?!\\u{1d236}).",
  "<(?!\\\\)(?=(?=([^a-z<>/]*))(?:\\1)[/](?=([^a-z<>]*))(?:\\2)(?:e(?=([\\u200b\\u{e0000}-\\u{e0fff}]*))(?:\\3)n)(?:[^a-z]|$))",
  ".*y",
  ".*?y",
  ".{2}",
  ".{1,3}?y",
  "(?:.|y)+$",
  "\\b.",
  "\\B.",
  "$",
  "",
];
const astral = "\u{1d236}";
const lead = "\ud834";
const trail = "\udd36";
const long = "abcdefghijklmnopqrstuvwxyz";
const texts = [
  "",
  astral,
  lead,
  trail,
  trail + lead,
  lead + lead + trail,
  lead + trail + trail,
  "x" + astral + "y",
  "x" + lead + "y",
  "x" + trail + "y",
  astral + astral,
  astral + "y",
  "y" + astral,
  "<" + astral + "/en>",
  "</en" + astral,
  "<​/e\u{e0001}n " + astral,
  "一" + astral + "一",
  "一丁y",
  long.slice(0, 6) + astral + "y",
  long.slice(0, 7) + astral + "y",
  long.slice(0, 8) + astral + "y",
  long.slice(0, 14) + astral + "y",
  long.slice(0, 15) + astral + "y",
  long.slice(0, 16) + astral + "y",
  long.slice(0, 17) + astral + "y",
  "一" + long + astral + "y" + long + lead,
  "一" + long + long + "y",
];
const show = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16)).join(".");
let sum = 0;
const mix = text => {
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
};
const lines = [];
for (const flags of ["u", "iu", "gu", "giu", "yu", "su", "mu", "v", "g", ""]) {
  for (const source of sources) {
    let pattern;
    try {
      pattern = new RegExp(source, flags);
    } catch (error) {
      mix(source + flags + error.name);
      continue;
    }
    for (const text of texts) {
      let line = "";
      for (let from = 0; from <= text.length; from++) {
        pattern.lastIndex = from;
        const found = pattern.exec(text);
        line += found
          ? `${found.index}:${found.map(part => (part === undefined ? "-" : show(part))).join("|")}@${pattern.lastIndex};`
          : `n@${pattern.lastIndex};`;
        if (!pattern.global && !pattern.sticky) break;
      }
      pattern.lastIndex = 0;
      line += show(text.replace(pattern, "[$&]")) + " " + text.search(pattern) + " " + text.split(pattern).length;
      mix(line);
      if (source.length > 60 || (flags === "giu" && text.length < 4 && source.length < 4))
        lines.push(`/${source.slice(0, 12)}/${flags} ${show(text)} ${line}`);
    }
  }
}
console.log(sum);
console.log(lines.join("\n"));
