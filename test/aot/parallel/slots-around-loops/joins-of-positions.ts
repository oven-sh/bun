// A position in a module variable or a field that several arms of a loop store: the arms meet with one value, and the ways out of a rare inner loop stay apart from the others.
// STATISTIC: CarriedVariablesMergedAtJoins >= 2
// STATISTIC: JoinsPartedByCarriedFields >= 1
const text = "ab  c\n# note\n\tdef   12 ghi\n~k # end";
let pos = 0;
let line = 1;
let fuel = 0;

function skipBlanks(): void {
  while (pos < text.length) {
    const code = text.charCodeAt(pos);
    if (code === 32 || code === 9) pos++;
    else if (code === 10) { line++; pos++; }
    else if (code === 35) { while (pos < text.length && text.charCodeAt(pos) !== 10) pos++; }
    else return;
  }
}
function mixed(): number {
  let sum = 0;
  while (pos < text.length && fuel++ < 40) {
    const code = text.charCodeAt(pos);
    sum = (sum + code) | 0;
    if (code === 32) pos += 2;
    else if (code === 10) pos += 1.5;
    else if (code === 35) { while (pos < text.length && text.charCodeAt(pos) !== 10) pos++; }
    else if (code > 100) pos += text.length > 5 ? 1 : 0.5;
    else pos++;
  }
  return sum;
}
function moved(): number {
  let sum = 0;
  while (pos < text.length && fuel++ < 40) {
    if (text.charCodeAt(pos) === 32) { pos++; sum++; } else if (fuel & 1) back(); else pos += 3;
  }
  return sum;
}
function back(): void { pos -= 1; line += 2; }
function word(): string { skipBlanks(); const start = pos; while (pos < text.length && text.charCodeAt(pos) > 32) pos++; return text.slice(start, pos); }

class Lexer {
  pos = 0;
  line = 1;
  constructor(readonly text: string) {}
  skipBlanks(): void {
    while (this.pos < this.text.length) {
      const code = this.text.charCodeAt(this.pos);
      if (code === 32 || code === 9) this.pos++;
      else if (code === 10) { this.line++; this.pos++; }
      else if (code === 35) { while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 10) this.pos++; }
      else return;
    }
  }
  word(): string { this.skipBlanks(); const start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) > 32) this.pos++; return this.text.slice(start, this.pos); }
}
const kept = new Lexer(text);

function fromModule(start: number): string {
  const found: string[] = [];
  pos = start;
  line = 1;
  for (let k = 0; k < 12; k++) found.push(word(), String(pos), String(line));
  pos = start;
  fuel = 0;
  found.push(String(mixed()), Object.is(pos, -0) ? "-0" : String(pos));
  pos = start;
  fuel = 0;
  found.push(String(moved()), String(pos), String(line));
  return found.join("|");
}
function fromField(start: number): string {
  const found: string[] = [];
  kept.pos = start;
  kept.line = 1;
  for (let k = 0; k < 12; k++) found.push(kept.word(), String(kept.pos), String(kept.line));
  return found.join("|");
}
for (const start of [0, 3, -2, 0.5, -0, NaN, 2147483646, 9007199254740991]) {
  console.log(start, fromModule(start));
  console.log(start, fromField(start));
}
export {};
