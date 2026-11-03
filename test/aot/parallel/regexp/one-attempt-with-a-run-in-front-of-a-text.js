// `^(?:.*\/)?[^\/]*\.pem$`, made at run time as a library for ignore rules makes it: one attempt, a run first, and a text that every match holds.
// A subject without the text has no match, however long the attempt would walk. The answers and the places are those of an attempt that walks:
// short and long subjects, 8-bit and 16-bit, the text at the start, at the end, cut off, in the other case, behind a line break, behind lastIndex.
const made = text => text + String(Date.now()).slice(99);
const sources = [
  ["^(?:.*\\/)?[^\\/]*\\.pem(?=$|\\/$)", "i"], ["^(?:.*\\/)?[^\\/]*\\.pem(?=$|\\/$)", ""], ["^(?:.*\\/)?tmp\\/.+(?=$|\\/$)", "i"], ["^.*\\.KEY$", "i"], ["^.*\\.key$", ""],
  ["^[^]*needle", ""], ["^.*needle", ""], ["^.*needle", "s"], ["^.*needle", "m"], ["^(.*)(needle)(.*)$", ""], ["^(?:a|.*b)needle", ""], ["^.*?needle.*?end", ""],
  ["^\\s*(?:\\w+\\s+)*stop\\b", ""], ["^.*needle", "g"], ["^.*needle", "y"], ["^.*needle", "u"], ["^.*straße", "i"], ["^.*ſtop", "iu"], ["^.*kelvin", "iu"], ["^.*ﷺ\\.pem", ""],
  ["^.*needle|^other", ""], ["^.*needle|other", ""], ["^(?=.*needle).*x", ""], ["^(?!.*needle).*x", ""], ["^.*(?<=nee)dle", ""], ["^.*(?:needle)?x$", ""], ["^.*(?:needle)+x$", ""], ["^.*[n]eedl[e]", ""],
];
const fillers = ["x", "xy/", "ab cd ", "ﷺ", "n", "needl", "NEEDLE ", "\n", "x\n", "\u{1f600}"];
const texts = ["", "needle", "NEEDLE", "a.pem", "A.PEM", "a.pem/", "tmp/x", ".key", ".KEY", "needle end", "stop", "straße", "STRASSE", "stop ſtop", "Kelvin", "ﷺ.pem", "other", "needlex", "needleneedlex", "dle"];
const lengths = [0, 1, 7, 31, 33, 200, 255, 256, 257, 300, 2000];
let sum = 0;
const lines = [];
for (const [source, flags] of sources) {
  const pattern = new RegExp(made(source), flags);
  let line = "";
  for (const filler of fillers) {
    for (const text of texts) {
      for (const length of lengths) {
        const run = made(filler).repeat(Math.ceil(length / filler.length));
        for (const subject of [run + text, text + run, run + text + run, run + text.slice(0, -1)]) {
          for (const from of flags.includes("g") || flags.includes("y") ? [0, 1, length] : [0]) {
            pattern.lastIndex = from;
            const match = pattern.exec(subject);
            const seen = match ? match.index * 31 + match[0].length * 7 + match.length + (match[1]?.length ?? 0) * 3 + pattern.lastIndex : -1 - pattern.lastIndex;
            sum = (sum * 33 + seen) | 0;
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
