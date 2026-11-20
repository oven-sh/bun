const program = JSON.parse(JSON.stringify("# note\nloop: add t0, [a1, 0x1f] \"q\"\n\tjmp .next::end\n" + "  a b_c 12 true trues\n".repeat(3) + "été € K\n"));
function scan(source, regexp) { return source.match(regexp); }
function lex(str) {
  const found = [];
  let m;
  while (str.length) {
    if ((m = scan(str, /^#([^\n]*)/))) found.push("note" + m[1]);
    else if ((m = scan(str, /^\n/))) found.push("line");
    else if ((m = scan(str, /^[a-zA-Z]([a-zA-Z0-9_.]*)/))) found.push("name " + m[0] + "/" + m[1] + "/" + m.index + "/" + m.input.length);
    else if ((m = scan(str, /^([ \t]+)/))) { str = str.slice(m[0].length); continue; }
    else if ((m = scan(str, /^0x([0-9a-f]+)|^([0-9]+)/i))) found.push("number " + m[1] + m[2]);
    else if ((m = scan(str, /^(?:::|[:,\[\].])/))) found.push(m[0]);
    else if ((m = scan(str, /^".*"/))) found.push("text " + m[0]);
    else if ((m = scan(str, /^[^\x00-\x7f]/))) found.push("wide " + m[0].charCodeAt(0));
    else throw new Error("stops at " + str.slice(0, 5));
    str = str.slice(m[0].length);
  }
  return found.join("|");
}
console.log(lex(program));
console.log(lex(("<" + program + ">").slice(1, 1 + program.indexOf("é"))));

const subjects = JSON.parse(JSON.stringify(["", "a", "A", "á", "ša", "k", "K", "K", "ſ", "s", "\u0000", "aa", "ba", "😀", "0", "\n"]));
function each(list) {
  let log = "";
  for (const s of list) {
    log += /^a/.test(s) ? 1 : 0;
    log += /^[ks]/i.test(s) ? 1 : 0;
    log += /^[ks]/iu.test(s) ? 1 : 0;
    log += /^š|^\0/.test(s) ? 1 : 0;
    log += /^a*b/.test(s) ? 1 : 0;
    log += /^a*/.test(s) ? 1 : 0;
    log += /^[^a]/.test(s) ? 1 : 0;
    log += /^(?=a)./.test(s) ? 1 : 0;
    log += /^a/m.test(s) ? 1 : 0;
    log += s.search(/^[a-c]/);
    log += /^(?:[^\W\d]|\d)/.exec(s) ? 1 : 0;
    log += " ";
  }
  return log;
}
console.log(each(subjects));
console.log(each(subjects.map((s) => ("<" + s + ">").slice(1, -1))));
console.log(each(subjects.map((s) => "\n" + s)));

class Own { constructor(text) { this.text = text; this.length = text.length; } match(regexp) { return this.text === "" ? null : [regexp.source + this.text.charAt(0)]; } slice(from) { return new Own(this.text.slice(from)); } }
function own(list) {
  let log = "";
  for (const s of list) {
    try { const m = s.match(/^b(.)/); log += m ? m[0] + m[1] : "-"; } catch (error) { log += error.constructor.name; }
    log += ",";
  }
  return log;
}
console.log(own(["abc", "bcd", new Own("xyz"), new Own(""), new String("bz"), null, 7, undefined, { match() { return ["m", "n"]; } }, "b"]));

function recorded(list) {
  let log = "";
  for (const s of list) {
    const part = ("(" + s + ")").slice(1, -1);
    if (/^(.)(b)/.test(part)) log += RegExp.$1 + RegExp.$2 + RegExp.lastMatch + RegExp.leftContext.length + RegExp.rightContext;
    else log += "-" + RegExp.lastMatch;
  }
  return log;
}
console.log(recorded(["abc", "xbz", "q", "", "€b!", "bb"]));
