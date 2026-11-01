// Each pattern repeats a group whose body can match the empty string. Each subject begins with a stretch that the group can divide among its turns in many ways, none of which leads to a match. The match lies behind the stretch.
const literals = [
  /([^0]*)+1$/,
  /(?:[^0]*)+1$/,
  /(?<run>[^0]*)+1$/,
  /([^0]*)*1$/,
  /([^0]*?)+1$/,
  /([^0]*)+?1$/,
  /([^0]*?)*?1$/,
  /([^0]?)+1$/,
  /([^0]{0,2}){2,}1$/,
  /([^0]*){1,9}1$/,
  /((?:[^0]*)+)1$/,
  /([^0]|)+1$/,
  /(|[^0])+1$/,
  /([^0]*|1)+1$/,
  /([^0]*\b)+1$/,
  /([^0]*(?=.|$))+1$/s,
  /([^0]*)+\S$/,
  /\S([^0]*)+\S$/,
  /\S{1,3}([^0]*)+\S$/,
  /\b([^0]*)+\S$/,
  /[^0]*\S{1,3}([^0]*)+\S$/,
  /\b[^0]*\S{1,3}([^0]*)+\S$/gs,
  /\b[^0]*\S{1,3}([^0]*)+\S$/iu,
  /([^0]*)+\1 ?1$/,
  /(?<=(\S*)+) 1+$/,
  /(\D*\d?)+ 1$/,
];
const nothing = String(Date.now()).slice(99);
const madeAtRunTime = literals.map(literal => new RegExp("(?:)" + literal.source + nothing, literal.flags));

function show(match) {
  return match === null ? "-" : match.index + ":" + Array.from(match, part => (part === undefined ? "~" : part.length)).join(",");
}

const fills = ["1", "±", "ı", "丱", "1丱", "±1 "];
for (const patterns of [literals, madeAtRunTime]) {
  for (const pattern of patterns) {
    const line = [];
    for (const fill of fills) {
      for (const turns of [0, 1, 2, 3, 5, 8, 10]) {
        const stretch = fill.repeat(turns).slice(0, turns);
        for (const subject of [stretch + "0 " + fill + "11", stretch + "10\n" + fill + " 1", stretch + "0"]) {
          pattern.lastIndex = 0;
          const match = pattern.exec(subject);
          pattern.lastIndex = 0;
          line.push(show(match) + (pattern.test(subject) === (match !== null) ? "" : " test differs") + (subject.search(pattern) === (match === null ? -1 : match.index) ? "" : " search differs"));
          pattern.lastIndex = 0;
          line.push(subject.replace(pattern, "<$1>").length + "," + subject.split(pattern, 4).length);
        }
      }
    }
    console.log(String(pattern), line.join(" "));
  }
}
