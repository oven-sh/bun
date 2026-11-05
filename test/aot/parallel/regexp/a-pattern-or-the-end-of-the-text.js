// `(?:\/name)|$`, made at run time: a pattern with an alternative that matches nothing at the end of the text, so that a search always finds something.
const made = text => text + String(Date.now()).slice(99);
const sources = [
  ["(?:(?:^|\\/)private(?=$|\\/$))|$", "i"], ["(?:(?:^|\\/)Straße(?=$|\\/$))|$", "i"], ["(?:^(?:.*\\/)?[^\\/]*\\.pem(?=$|\\/$))|$", "i"], ["(?:(?:^|\\/)[^\\/]*\\.log(?=$|\\/$))|$", "i"],
  ["(?:^private\\/.+(?=$|\\/$))|$", ""], ["needle|$", ""], ["$|needle", ""], ["needle|$", "i"], ["needle|$", "g"], ["needle|$", "y"], ["needle|$", "m"], ["needle|$", "gm"], ["needle|$", "u"], ["needle|$", "iu"], ["needle|$", "v"],
  ["(needle)|($)", ""], ["(?:needle|$)", ""], ["(?:needle|$)x?", ""], ["(?:n|$)(?:e|$)", ""], ["(?:,|$)", "g"], ["[^,]*(?:,|$)", "g"], ["n|$|e", ""], ["^|$", "g"], ["^needle|$", ""], ["^needle|$", "g"], ["needle$|$", ""],
  ["n*$", ""], ["n?$", ""], ["(?:n|e)*$", ""], ["\\s*$", ""], [".*$", ""], [".*$", "s"], ["$\\b|needle", ""], ["\\b$|needle", ""], ["(?=$)|needle", ""], ["(?!.)|needle", ""], ["needle|$(?<=x)", ""], ["(?<=x)$|needle", ""],
  ["x.*needle|$", ""], ["x[^/]*needle|$", ""], ["\\/.*?needle|$", ""], [".*needle|$", ""], ["^.*needle|$", ""], ["^.*needle|$", "g"], ["^.*(needle)|$", ""], ["ﷺ|$", ""], ["ﷺneedle|$", ""], ["\\u{1f600}|$", "u"], ["[\\u{1f600}-\\u{1f64f}]n|$", "u"],
  ["\\udc00|$", ""], ["\\udc00|$", "u"], ["(?:needle|$){2}", ""], ["(?:needle|$)+", ""], ["(?:needle|$)*x", ""], ["needle|other|$", ""], ["needle|$|^other", ""], ["[]|$", ""], ["$", ""], ["$", "g"], ["$$|needle", ""], ["(?:$)|needle", ""],
];
const fillers = ["x", "xy/", "ﷺ", "n", "needl", "NEEDLE ", "x\n", "\u{1f600}", ","];
const texts = ["", "needle", "NEEDLE", "/private", "/PRIVATE/", "/Straße", "a.pem", "a.LOG/", "other", "e", ",", "ﷺneedle", "\u{1f600}n", "\udc00"];
const lengths = [0, 1, 2, 3, 4, 5, 16, 17, 33, 129, 256, 257, 700];
let sum = 0;
const lines = [];
for (const [source, flags] of sources) {
  const pattern = new RegExp(made(source), flags);
  const moves = flags.includes("g") || flags.includes("y");
  let line = "";
  for (const filler of fillers) {
    for (const text of texts) {
      for (const length of lengths) {
        const run = made(filler).repeat(Math.ceil(length / filler.length));
        for (const subject of [run + text, text + run, run + text + run, run + text.slice(0, -1)]) {
          for (const from of moves ? [0, 1, length, subject.length, subject.length + 1] : [0]) {
            pattern.lastIndex = from;
            const match = pattern.exec(subject);
            const seen = match ? match.index * 31 + match[0].length * 7 + match.length + (match[1]?.length ?? -1) * 3 + (match[2]?.length ?? -1) * 5 + pattern.lastIndex : -1 - pattern.lastIndex;
            sum = (sum * 33 + seen) | 0;
            pattern.lastIndex = from;
            if (pattern.test(subject) !== !!match) line += "!";
          }
          if (length <= 33) {
            pattern.lastIndex = 0;
            sum = (sum * 33 + subject.replace(pattern, "<$&>").length * 3 + subject.split(pattern).length + subject.search(pattern)) | 0;
          }
        }
      }
    }
  }
  lines.push(`${source} ${flags} ${sum}${line}`);
}
console.log(lines.join("\n"));
