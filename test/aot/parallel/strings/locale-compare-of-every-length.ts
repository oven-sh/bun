// Every pair of texts of many lengths, compared by localeCompare off a string and off a value that nobody knows.
const texts: string[] = [];
const letters = ["a", "A", "b", "0", "9", " ", "-", "\u0001", "\u007f", "é", "́", "中", "'", "_", "."];
for (const c of letters) texts.push(c);
let seed = 7;
function next(n: number): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; }
for (let length = 0; length <= 13; length++) for (let k = 0; k < 8; k++) {
  let s = "";
  for (let i = 0; i < length; i++) s += next(9) ? String.fromCharCode(97 + next(3)) : letters[next(letters.length)];
  texts.push(s);
  if (length) texts.push(s.slice(0, length - 1) + String.fromCharCode(97 + next(4)), s.slice(0, next(length)) + letters[next(letters.length)] + s.slice(next(length)), s + "x");
}
for (let i = 0; i < 40; i++) texts.push("foo" + i * 37, "foobar" + i * 11);
class Sign { _value: any; constructor(v: any) { this._value = v; } compareTo(o: any): number { return this._value.localeCompare(o._value); } }
const signs: any[] = texts.map(t => new Sign(t));
let lines: string[] = [], sum = 0;
for (let i = 0; i < texts.length; i++) {
  let line = "";
  for (let j = 0; j < texts.length; j++) {
    const a = texts[i]!.localeCompare(texts[j]!), b = signs[i].compareTo(signs[j]);
    line += a < 0 ? "<" : a > 0 ? ">" : "=";
    if (a !== b) line += "!";
    sum += a;
  }
  lines.push(line);
}
console.log(lines.join("\n"), sum);
export {};
