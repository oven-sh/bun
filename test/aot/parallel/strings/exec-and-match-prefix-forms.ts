const lines: string[] = [];
function log(text: string): void {
  lines.push(text);
}
function show(part: string | undefined): string {
  return part === undefined ? "<undefined>" : part;
}
function state(re: RegExp): string {
  return "lastIndex=" + re.lastIndex + " $1=" + RegExp.$1 + " $2=" + RegExp.$2;
}

function rope(parts: string[]): string {
  let text = "";
  for (const part of parts) text += part;
  return text;
}
const flat = "key=value;other=thing";
const roped = rope(["ke", "y=va", "lue;oth", "er=thing"]);
const cut = ("xxxx" + flat + "yyyy").substring(4, 4 + flat.length);
const wide = "clé=valeur;其他=东西";
const subjects: string[] = [flat, roped, cut, wide, "", "no separators here"];

function execNoGroups(s: string): string {
  const re = /=/;
  const m = re.exec(s);
  if (m) return show(m[0]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}
function execTwoGroups(s: string): string {
  const re = /(\p{L}+)=(\p{L}+)/u;
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}
function execThreeGroups(s: string): string {
  const re = /(\w+)(=)(\w+)/;
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + show(m[3]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}
function execOptionalGroup(s: string): string {
  const re = /(y)(zzz)?(=)/;
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + show(m[3]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}
function execBeyondLastGroup(s: string): string {
  const re = /(=)/;
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + m.length;
  return "null";
}
function execGlobal(s: string): string {
  const re = /(\w+)=(\w+)/g;
  let text = "";
  for (let i = 0; i < 3; i++) {
    const m = re.exec(s);
    if (m) text += show(m[1]) + "," + show(m[2]) + "," + m.length + " " + state(re) + ";";
    else text += "null " + state(re) + ";";
  }
  return text;
}
function execSticky(s: string): string {
  const re = /(\w)(\w)/y;
  let text = "";
  for (let i = 0; i < 3; i++) {
    const m = re.exec(s);
    if (m) text += show(m[1]) + show(m[2]) + " " + state(re) + ";";
    else text += "null " + state(re) + ";";
  }
  return text;
}
function execIndices(s: string): string {
  const re = new RegExp("(\\w+)=(\\w+)", "d");
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}
function execNamed(s: string): string {
  const re = /(?<name>\w+)=(?<content>\w+)/;
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}
function execWithPatternParameter(re: RegExp, s: string): string {
  const m = re.exec(s);
  if (m) return show(m[1]) + "|" + show(m[2]) + "|" + m.length + "|" + state(re);
  return "null|" + state(re);
}

function matchNoGroups(s: string): string {
  const re = /=/;
  const [whole, missing] = s.match(re) ?? [];
  return show(whole) + "|" + show(missing) + "|" + state(re);
}
function matchTwoGroups(s: string): string {
  const re = /(\w+)=(\w+)/;
  const [, a, b] = s.match(re) ?? [];
  return show(a) + "|" + show(b) + "|" + state(re);
}
function matchThreeGroups(s: string): string {
  const re = /(\w+)(=)(\w+)/;
  const [, a, b, c] = s.match(re) ?? [];
  return show(a) + "|" + show(b) + "|" + show(c) + "|" + state(re);
}
function matchOptionalGroup(s: string): string {
  const re = /(y)(zzz)?(=)/;
  const [, a, b, c] = s.match(re) ?? [];
  return show(a) + "|" + show(b) + "|" + show(c) + "|" + state(re);
}
function matchGlobalDestructured(s: string): string {
  const re = /\w+/g;
  const [first, second, third] = s.match(re) ?? [];
  return show(first) + "|" + show(second) + "|" + show(third) + "|" + state(re);
}
function matchGlobalLength(s: string): string {
  const re = /=/g;
  const m = s.match(re);
  return m ? show(m[0]) + "|" + m.length + "|" + state(re) : "null|" + state(re);
}
function matchSticky(s: string): string {
  const re = /(\w)(\w)/y;
  const first = s.match(re);
  const second = s.match(re);
  return (first ? show(first[2]) : "null") + "|" + (second ? show(second[2]) : "null") + "|" + state(re);
}
function matchNamed(s: string): string {
  const re = /(?<name>\w+)=(?<content>\w+)/;
  const [, a, b] = s.match(re) ?? [];
  return show(a) + "|" + show(b) + "|" + state(re);
}

for (const s of subjects) {
  log("subject " + JSON.stringify(s));
  log(execNoGroups(s));
  log(execTwoGroups(s));
  log(execThreeGroups(s));
  log(execOptionalGroup(s));
  log(execBeyondLastGroup(s));
  log(execGlobal(s));
  log(execSticky(s));
  log(execIndices(s));
  log(execNamed(s));
  log(execWithPatternParameter(/(\w)=(\w)/, s));
  log(matchNoGroups(s));
  log(matchTwoGroups(s));
  log(matchThreeGroups(s));
  log(matchOptionalGroup(s));
  log(matchGlobalDestructured(s));
  log(matchGlobalLength(s));
  log(matchSticky(s));
  log(matchNamed(s));
}

function hotLoop(parts: string[]): string {
  const re = /(\d+)-(\d+)?(x)?/;
  let total = 0;
  let text = "";
  for (let round = 0; round < 2000; round++) {
    const s = parts[round % parts.length];
    const m = re.exec(s);
    if (m) {
      total += Number(m[1]) + m.length;
      if (m[2] === undefined) total += 7;
      if (m[3] !== undefined) total += 11;
    }
    const [, a, b] = s.match(re) ?? [];
    if (a !== undefined) total += a.length;
    if (b !== undefined) total += b.length;
    if (round % 500 === 0) text += state(re) + ";";
  }
  return total + " " + text;
}
log(hotLoop(["12-34x", "5-", "none", rope(["7", "8-", "9"]), "٣-٤"]));

function wholeIndex(s: string): string {
  const m = /(b)/.exec(s);
  return m ? m.index + "|" + m.input + "|" + show(m[1]) : "null";
}
function wholeGroups(s: string): string {
  const m = /(?<year>\d{4})-(?<month>\d\d)/.exec(s);
  return m ? show(m.groups?.year) + "|" + show(m.groups?.month) + "|" + show(m[1]) : "null";
}
function wholeReturned(s: string): RegExpExecArray | null {
  return /(a)(b)?/.exec(s);
}
function wholeMatchGlobal(s: string): string[] | null {
  return s.match(/a/g);
}
log(wholeIndex("abc"));
log(wholeIndex("xyz"));
log(wholeGroups("on 2026-10"));
log(wholeGroups("never"));
log(JSON.stringify(wholeReturned("za")));
log(JSON.stringify(wholeReturned("zz")));
log(JSON.stringify(wholeMatchGlobal("banana")));
log(JSON.stringify(wholeMatchGlobal("xyz")));

function lastIndexObject(): string {
  const re = /(a)(b)/g;
  const seen: string[] = [];
  (re as any).lastIndex = {
    valueOf() {
      seen.push("v");
      return 0;
    },
  };
  const m = re.exec("xab");
  return (m ? show(m[1]) + show(m[2]) : "null") + "|" + seen.join("") + "|" + re.lastIndex;
}
log(lastIndexObject());

function ownExec(): string {
  const re = /(a)(b)/;
  re.exec = () => null;
  const m = re.exec("ab");
  const [, a, b] = "ab".match(re) ?? [];
  return (m ? show(m[1]) : "null") + "|" + show(a) + "|" + show(b);
}
log(ownExec());

class Counting extends RegExp {
  calls = 0;
  exec(s: string): RegExpExecArray | null {
    this.calls++;
    return super.exec(s);
  }
}
function subclass(): string {
  const re = new Counting("(a)(b)");
  const m = re.exec("ab");
  const [, a, b] = "ab".match(re) ?? [];
  return (m ? show(m[2]) : "null") + "|" + show(a) + "|" + show(b) + "|" + re.calls;
}
log(subclass());

function readOnlyLastIndex(): string {
  const re = /a/g;
  Object.defineProperty(re, "lastIndex", { writable: false });
  try {
    re.lastIndex = 1;
    return "stored " + re.lastIndex;
  } catch (error) {
    return error instanceof TypeError ? "TypeError " + re.lastIndex : "other";
  }
}
log(readOnlyLastIndex());

console.log(lines.join("\n"));
