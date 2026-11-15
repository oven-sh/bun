// STATISTIC: SubstringsCarriedByPosition >= 1
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
    else throw "Lexer error at line " + line + ": " + str.slice(0, 5) + RegExp.leftContext.length;
    str = str.slice(m[0].length);
  }
  return result;
}
// Strings that end the loop early, are cut by nothing and by more than there is, and whose matches are looked at elsewhere.
function head(str, stop) {
  const out = [];
  for (let turns = 0; str.length && turns < 300; turns++) {
    let m;
    if ((m = str.match(/^([a-z])([a-z]*)/))) out.push(m[2] + m[1]);
    else if ((m = str.match(/^\d\d/))) {
      str = str.substring(m[0].length * (turns % 7));
      continue;
    } else if ((m = str.match(/^\d/))) {
      if (turns % 3 === 0) continue;
      out.push(str.length);
    } else if ((m = str.match(/^[^\x00-\x7f]+/))) out.push(m[0] + m[0].length);
    else if ((m = str.match(/^!+/))) {
      if (stop) break;
      out.push(RegExp.lastMatch + RegExp.input.length + RegExp.leftContext + RegExp.rightContext.length);
    } else {
      str = str.substr(1);
      continue;
    }
    str = str.substring(m[0].length);
  }
  return out.join("|") + ";" + str;
}
const show = (make) => {
  try {
    const made = make();
    console.log(typeof made === "string" ? made : made.map((token) => token.line + ":" + JSON.stringify(token.string)).join(" "));
  } catch (error) {
    console.log("threw", typeof error === "string" ? error : error.constructor.name);
  }
};
const source = 'macro a(b)\n  c = 0x1f # note\n  "q\\"r" 12\nend\n';
for (let round = 0; round < 3; round++) {
  show(() => lex(source));
  show(() => lex(source.repeat(3).slice(7)));
  show(() => lex(["x y", source].join(" ")));
  show(() => lex(" " + source + "z"));
  show(() => lex("ab é12"));
  show(() => lex("日本"));
  show(() => lex("abc 12 日本"));
  show(() => lex(Buffer.from("k = 1\n# é\nl = 2").toString()));
  show(() => lex(""));
  show(() => lex("a ?".slice(1)));
  show(() => lex(source + "\u0000"));
  for (const stop of [false, true]) {
    show(() => head("ab12cd!!34ef5g日本!x6 7!", stop));
    show(() => head("z".repeat(40) + "!" + source, stop));
    show(() => head((source + "é!é1").slice(3, -1), stop));
    show(() => head("1234567890!", stop));
    show(() => head("11!aa22!bb", stop));
    Bun.gc(true);
  }
  console.log(RegExp.lastMatch.length, RegExp.$1, RegExp.input.length);
}
for (const odd of [null, 7, ["a", "b"], { length: 0 }, new String("ab 1")]) show(() => lex(odd));
