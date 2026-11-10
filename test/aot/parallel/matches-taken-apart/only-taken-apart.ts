// Every shape here only takes the result of exec | match apart: the array is never made. What is printed is what plain Bun prints.
// STATISTIC: MatchesTakenInParts >= 11
const unseen = (x: any): any => [x][JSON.parse("0")];
const lines: string[] = unseen(["color=red", "size=", "=none", "plain", "", "wide=中文", "a=b=c", "UP=down"]);
const told: string[] = [];

function keyOf(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (m) return m[1] + "|" + m[2];
  return "none";
}
function comparedWithNull(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (m === null) return "null";
  return m[2]!;
}
function comparedLoosely(line: string): string {
  const m = line.match(/^([a-z]+)=(.*)$/);
  if (m == null) return "null";
  return m[0] + "/" + m[1];
}
function negated(line: string): string {
  const m = line.match(/([a-z])([0-9])?/);
  if (!m) return "no";
  return String(m[1]) + ":" + String(m[2]);
}
function chained(line: string): string {
  const m = /(=)(x)?/.exec(line);
  return String(m?.[1]) + String(m?.[2]);
}
function both(line: string): string {
  const m = /^(\w+)=/.exec(line);
  return String(m && m[1]);
}
function properties(line: string): string {
  const m = /=(.)/.exec(line);
  if (!m) return "-";
  return m.index + "," + m.input + "," + m.length + "," + m[1];
}
function measured(line: string): number {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return -1;
  return m[1]!.length * 100 + m[2]!.length;
}
function compared(line: string): boolean {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  return m !== null && m[1] === "color";
}
function numbered(text: string): number {
  const m = /^(\d+)-(\d+)$/.exec(text);
  if (!m) return NaN;
  return Number(m[1]) + parseInt(m[2]!, 10);
}
function everyMatch(text: string): string {
  const re = /([a-z])=([a-z]?)/g;
  let out = "";
  let m;
  while ((m = re.exec(text)) !== null) out += m[1] + m[2] + "@" + m.index + ";";
  return out + re.lastIndex;
}
function sticky(text: string): string {
  const m = /a(b)?/y.exec(text);
  if (!m) return "miss";
  return m[0] + String(m[1]);
}
function pattern(line: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(line);
  if (!m) return "none";
  const [whole, key, value] = m;
  return whole + "<" + key + "<" + value;
}
function onlyTested(line: string): string {
  const m = /=/.exec(line + "");
  return m ? "has" : "lacks";
}
function nested(line: string): string {
  const m = /^((a)|(b))=((?:(c))?)$/.exec(line);
  if (!m) return "none";
  return [m[1], m[2], m[3], m[4], m[5]].map(String).join(",");
}
function repeated(line: string): string {
  const m = /^(?:([a-z])([0-9])?)+$/.exec(line);
  if (!m) return "none";
  return String(m[1]) + String(m[2]);
}
function ofPiece(text: string, from: number, to: number): string {
  const m = /^([a-z]+)=(.*)$/.exec(text.slice(from, to));
  if (!m) return "none";
  return m[1] + "~" + m[2] + "~" + m.index;
}
function ofRope(a: string, b: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(a + b);
  if (!m) return "none";
  return m[1] + "+" + m[2];
}

for (const line of lines) {
  told.push(
    [keyOf(line), comparedWithNull(line), comparedLoosely(line), negated(line), chained(line), both(line), properties(line), measured(line), compared(line), pattern(line), onlyTested(line)].join(" "),
  );
}
for (const text of unseen(["12-30", "7-x", "007-011", ""])) told.push(String(numbered(text)));
for (const text of unseen(["a=b c=d e=", "", "zz"])) told.push(everyMatch(text));
for (const text of unseen(["ab", "a", "ba"])) told.push(sticky(text));
for (const text of unseen(["a=c", "b=", "c=c", "a=", "b=c"])) told.push(nested(text));
for (const text of unseen(["a1b", "a1b2", "a", "1"])) told.push(repeated(text));
const whole: string = unseen("xx color=red yy size=big zz");
told.push(ofPiece(whole, 3, 12), ofPiece(whole, 16, 24), ofPiece(whole, 0, 2));
told.push(ofRope(unseen("col"), unseen("or=red")), ofRope(unseen(""), unseen("")), ofRope(unseen("k=中"), unseen("文")));
console.log(told.join("\n"));
