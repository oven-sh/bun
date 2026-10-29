// Texts are joined of two to four strings of every kind, each of which may be empty, and what comes out is measured, read by position, searched and used as a key.
const short = ["", "a", "/orders", "0", "17"];
const long = "x".repeat(300);
const wide = "日本";
const rope = (left: string, right: string) => left + right;
function kinds(turn: number): string[] {
  const tail = String(turn & 7);
  return [
    ...short,
    long,
    long.slice(1, 200),
    wide,
    wide.slice(1),
    rope("left-" + tail, "-right"),
    rope(long, tail),
    rope(wide, tail),
    "/orders/17".slice(0, 7),
    "/orders/17".slice(10),
  ];
}
function two(a: string, b: string): string {
  return a + b;
}
function three(a: string, b: string, c: string): string {
  return `${a}${b}${c}`;
}
function four(a: string, b: string, c: string, d: string): string {
  let text = a;
  text += b;
  text += c;
  text += d;
  return text;
}
const seen: Record<string, number> = {};
let sum = 0;
function take(text: string, expectedLength: number): void {
  if (text.length !== expectedLength) throw new Error("a text of " + text.length + " for " + expectedLength);
  sum = (sum * 31 + text.length + (text.length ? text.charCodeAt(text.length - 1) + text.charCodeAt(0) : 7)) | 0;
  if (/^\/o/.test(text)) sum = (sum + 1) | 0;
  if (text.length < 12) seen[text] = (seen[text] ?? 0) + 1;
}
for (let turn = 0; turn < 40; turn++) {
  const all = kinds(turn);
  for (const a of all) {
    for (const b of all) {
      take(two(a, b), a.length + b.length);
      take(three(a, "".slice(turn), b), a.length + b.length);
      take(three("".slice(turn), a, b), a.length + b.length);
      take(three(a, b, "".slice(turn)), a.length + b.length);
      take(four(a, b, a, b), 2 * (a.length + b.length));
      take(four("".slice(turn), "".slice(turn), a, "".slice(turn)), a.length);
      take(four(b, "".slice(turn), "".slice(turn), "".slice(turn)), b.length);
    }
  }
}
console.log(sum, Object.keys(seen).length, JSON.stringify(Object.entries(seen).slice(0, 12)));
export {};
