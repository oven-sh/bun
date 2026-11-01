// `\/private`, made at run time, over subjects of 64 units and more: where a match can begin is found by two units of the text, a vector at a time.
const made = text => text + String(Date.now()).slice(99);
const sources = [
  ["\\/private", "i"], ["\\/private", ""], ["(?:^|\\/)private(?=$|\\/$)", "i"], ["needle", ""], ["needle", "i"], ["needle", "g"], ["needle", "u"], ["needle", "iu"], ["ne[a-z]dle", ""], ["n.edle", ""], ["[nN]eedle", ""],
  ["ne", ""], ["n\\d", ""], ["n\\dx", "i"], ["needle|nearby", ""], ["needle|other", ""], ["needle|$", ""], ["^x|needle", ""], ["ne+dle", ""], ["(ne)(ed)le", ""], ["\\bneedle", ""], ["(?=ne)needle", ""], ["needle(?!x)", ""],
  ["ßeta", "i"], ["éa", "i"], ["k1", "iu"], ["s1", "iu"], ["ﷺneedle", ""], ["nﷺe", ""], ["n\\u{1f600}e", "u"], ["@[x", "i"].map(text => text.replace("[", "\\[")), ["`{x", "i"].map(text => text.replace("{", "\\{")),
];
const fillers = ["x", "n", "ne", "/p", "xy/", "ﷺ", "e\u{1f600}"];
const texts = ["needle", "NEEDLE", "needlx", "nxxdle", "/private", "/PRIVATE/", "/prIvatx", "nearby", "n7x", "ßETA", "ÉA", "K1", "ſ1", "ﷺneedle", "nﷺe", "n\u{1f600}e", "@[x", "`{X", "@{x"];
const totals = [63, 64, 65, 67, 68, 79, 80, 81, 83, 84, 100, 300];
let sum = 0;
const lines = [];
for (const [source, flags] of sources) {
  const pattern = new RegExp(made(source), flags);
  let line = "";
  for (const filler of fillers) {
    const run = made(filler).repeat(300);
    for (const text of texts) {
      for (const total of totals) {
        for (const offset of [0, 1, 15, 16, 17, 31, 44, 47, 48, 60, total - text.length - 1, total - text.length]) {
          if (offset < 0 || offset + text.length > total) continue;
          const subject = run.slice(0, offset) + text + run.slice(0, total - offset - text.length);
          for (const from of flags.includes("g") ? [0, 1, offset, offset + 1] : [0]) {
            pattern.lastIndex = from;
            const match = pattern.exec(subject);
            sum = (sum * 33 + (match ? match.index * 31 + match[0].length * 7 + match.length + pattern.lastIndex : -1)) | 0;
            pattern.lastIndex = from;
            if (pattern.test(subject) !== !!match) line += "!";
          }
        }
      }
    }
  }
  lines.push(`${source} ${flags} ${sum}${line}`);
}
console.log(lines.join("\n"));
