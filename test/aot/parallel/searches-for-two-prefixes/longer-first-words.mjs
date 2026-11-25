// The first alternative is the longer one: what is left at the end of the text may be enough for the second alone.
const patterns = [
  [/abcdefghij|hgfedcba/, ["abcdefghij", "hgfedcba"]],
  [/abcdefghij|hgfedcba/gi, ["ABCdefghiJ", "HGFedcba"]],
  [/[acg]bcdefghijkl|hgfe[b-d]c/g, ["gbcdefghijkl", "hgfedc", "hgfebc"]],
  [/wxyz12|zyxw/, ["wxyz12", "zyxw"]],
  [/wxyz1234567890|zyxw/y, ["wxyz1234567890", "zyxw"]],
  [/(wxyz12)|zyxw$/m, ["wxyz12", "zyxw"]],
  [/foobarbaz(?=!)|quuxes/g, ["foobarbaz!", "foobarbaz", "quuxes"]],
];
const fillers = ["hgfe.wxyzfoobquux", "abcdHGFE,zyx", "-"];
let hash = 0, matches = 0;
function say(value) {
  const text = JSON.stringify(value) ?? "nothing";
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
}
for (const [pattern, words] of patterns) {
  for (const filler of fillers) {
    for (const word of words) {
      for (let length = 0; length < 40; length++) {
        const before = filler.repeat(40).slice(0, length);
        for (const text of [before + word, before + word + filler, before + word.slice(0, -1), word + before + word, before + word + "\u0153"]) {
          pattern.lastIndex = 0;
          const match = pattern.exec(text);
          matches += match !== null;
          say([match && [match[0], match.index, match[1]], pattern.lastIndex, text.search(pattern), text.replace(pattern, "<$&>"), text.split(pattern).length]);
        }
      }
    }
  }
}
console.log(hash, matches);
