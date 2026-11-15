// STATISTIC: FreshObjectsMergedAtJoins >= 6
// STATISTIC: WalkLoopsVersioned >= 5
class Token {
  constructor(line, string) {
    this.line = line;
    this.string = string;
  }
}
function scan(source, regexp) {
  return source.match(regexp);
}
function lex(str) {
  const result = [];
  let line = 1;
  while (str.length) {
    let m;
    if ((m = scan(str, /^#([^\n]*)/)));
    else if ((m = scan(str, /^\n/))) {
      result.push(new Token(line, m[0]));
      line++;
    } else if ((m = scan(str, /^[a-zA-Z]([a-zA-Z0-9_.]*)/))) result.push(new Token(line, m[0]));
    else if ((m = scan(str, /^([ \t]+)/))) {
      str = str.slice(m[0].length);
      continue;
    } else if ((m = scan(str, /^0x([0-9a-f]+)/))) result.push(new Token(line, parseInt(m[1], 16)));
    else if ((m = scan(str, /^([0-9]+)/))) result.push(new Token(line, m[0]));
    else if ((m = scan(str, /^[:,\(\)\[\]=]/))) result.push(new Token(line, m[0]));
    else if ((m = scan(str, /^"(\\.|[^"])*"/))) result.push(new Token(line, m[0]));
    else throw "Lexer error at line " + line + ": " + str.slice(0, 5);
    str = str.slice(m[0].length);
  }
  return result;
}
// The same without a helper, and with results that are kept, compared and read again behind the arms.
let last = null;
function split(str) {
  const out = [];
  for (let turns = 0; str && turns < 200; turns++) {
    let m;
    if ((m = str.match(/^([a-z])([a-z]*)/))) out.push(m[2] + m[1]);
    else if ((m = str.match(/^\d/))) out.push(+m[0]);
    else if ((m = str.match(/^[^\x00-\x7f]+/))) out.push(m);
    else if ((m = str.match(/^!/))) last = m;
    else {
      str = str.substring(1);
      continue;
    }
    if (m === last) out.push("same");
    str = str.substring(m[0].length);
  }
  return out.map(String).join("|");
}
const show = (make) => {
  try {
    const made = make();
    console.log(typeof made === "string" ? made : made.map((token) => token.line + ":" + JSON.stringify(token.string)).join(" "));
  } catch (error) {
    console.log("threw", typeof error === "string" ? error : error.constructor.name);
  }
};
const texts = JSON.parse('["a = [t0, 8] # note\\nloadi 0x1F, b.c\\n\\nx: y", "name(\\"q \\\\\\" r\\")", "", "# only", "é", "abc 12 é!z1"]');
for (const text of texts) {
  show(() => lex(text));
  show(() => lex(("<" + text + ">").slice(1, -1)));
  show(() => lex(text + " " + text));
  show(() => split(text));
  show(() => split(text + "!" + text));
}
// No strings.
const odd = { length: 2, turns: 0, match(regexp) { this.length = 0; return ["zz", "1"]; }, slice() { return "a1"; } };
show(() => lex(odd));
show(() => lex(["a", "b"]));
show(() => lex(new String("ab 1")));
show(() => lex(null));
show(() => split(Object.assign(() => 1, { match: () => ["q"], substring: () => "rest 1" })));
show(() => split(7));
