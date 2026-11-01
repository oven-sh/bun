// Patterns made at run time whose first characters come from a few sets, over 8-bit and 16-bit texts of 0 to 70 units: the match at every place, at none, and behind places that only look like a beginning.
const made = text => text + String(Date.now()).slice(99);
const sources = [
  "x[a-z]*[0-9]", "[xy][a-z]*[0-9]", "x[a-z][0-9]", "[xy][ab][0-9]", "[xy][ab][cd][0-9]", "[xy][ab][cd][ef][0-9]", "[xy][ab]?[0-9]", "x[a-z]+1", "(?:x|y)a[0-9]", "(?:xa|yb)[0-9]", "(?:xa|y)[0-9]*z", "[xy]a|[zw]b",
  "x[a-z]*[0-9]$", "^x[a-z]*[0-9]", "\\bx[a-z]*[0-9]", "[xy][ab](?=[0-9])", "(?<!\\.)x[a-z][0-9]", "[^.][a-z][0-9]", "[xy].[0-9]", "[xX][aA][0-9]", "[x\\u00e9][a-z][0-9]", "[x\\u4e00][a-z][0-9]", "x[a-z\\u4e00]*[0-9]",
];
const flagSets = ["", "g", "y", "i", "u", "gi", "m"];
const hits = ["xa1", "ya1", "xab1", "xabcd1", "yb2", "xacf3", "xaz", "Xa1", "éa1", "wb"];
const fillers = [".", "x", "xa", "xa.", "x.", "xac", "xace", "y", " ", "é", "一"];
let total = 0;
for (const source of sources) {
  let line = "";
  for (const flags of flagSets) {
    const pattern = new RegExp(made(source), flags);
    const moves = pattern.global || pattern.sticky;
    let sum = 0;
    const add = number => void (sum = (sum * 33 + number) | 0);
    for (const filler of fillers) {
      for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 23, 24, 25, 30, 31, 32, 33, 34, 35, 36, 47, 48, 49, 63, 64, 65, 70]) {
        const run = made(filler.repeat(Math.ceil(length / filler.length)).slice(0, length));
        for (const hit of ["", ...hits]) {
          for (const subject of [run + hit, hit + run, run + hit + run]) {
            for (const from of moves ? [0, 1, length >> 1, length, subject.length] : [0]) {
              pattern.lastIndex = from;
              const match = pattern.exec(subject);
              add(match ? match.index * 7 + match[0].length : -1);
              add(pattern.lastIndex);
              total++;
            }
          }
        }
        if (pattern.global) {
          pattern.lastIndex = 0;
          add((run + "xa1" + run + "yb2" + run).replace(pattern, "<$&>").length);
        }
      }
    }
    line += ` ${flags}:${(sum >>> 0).toString(36)}`;
  }
  console.log(source + line);
}
console.log(total);
