// Fractions of 1 to 20 digits behind whole parts of 1 to 12, alone, in lists and in objects; those that round to a whole number; empty lists.
let state = 12345;
function rnd(n: number): number { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor((state / 4294967296) * n); }
let hash = 0;
function note(text: string): void { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; }
const digits = (n: number, of: string): string => { let s = ""; for (let i = 0; i < n; i++) s += of[rnd(of.length)]; return s; };
for (const of of ["0123456789", "09", "9", "0", "5", "0000001"]) {
  let wrong = 0;
  for (let whole = 1; whole <= 12; whole++) {
    for (let fraction = 0; fraction <= 20; fraction++) {
      for (let k = 0; k < 4; k++) {
        const first = whole === 1 ? digits(1, of) : "123456789"[rnd(9)]!;
        const text = (rnd(2) ? "-" : "") + first + digits(whole - 1, of) + (fraction ? "." + digits(fraction, of) : "") + (rnd(9) ? "" : pickExponent());
        const n = Number(text);
        const list: number[] = JSON.parse("[" + text + "," + text + "]"), row: { n: number; m: number } = JSON.parse('{"n":' + text + ',"m":' + text + " }");
        if (!Object.is(list[0], n) || !Object.is(list[1], n) || !Object.is(row.n, n) || !Object.is(row.m, n)) { wrong++; if (wrong < 4) console.log(text, n, list[0], row.n); }
        note(String(list[0]) + (list[0]! | 0) + (row.n === Math.floor(row.n)));
      }
    }
  }
  console.log(of, wrong, hash);
}
function pickExponent(): string { return "e" + ["", "+", "-"][rnd(3)] + rnd(30); }
for (const text of ["1.", "-", "-.5", "01.5", "00", "1.e5", "1..2", "1.2.3", "0x1", "1.2e", "--1.5", "1.5-", "12345678.", "12345678.x"]) {
  let outcome = "";
  for (const whole of [text, "[" + text + "]", '{"a":' + text + "}", "[1.5," + text + "]"]) { try { outcome += JSON.stringify(JSON.parse(whole)); } catch (e: any) { outcome += e.name + " "; } }
  console.log(text, outcome);
}
const lists: { a: number[]; b: number[][]; c: {}[] }[] = JSON.parse("[" + Array.from({ length: 40 }, () => '{"a":[],"b":[[],[ ],[1]],"c":[{},{ }]}').join() + "]");
lists[0]!.a.push(1); lists[1]!.b[0]!.push(2); lists[2]!.b.push([]); (lists[3]!.c[0] as any).x = 1; lists[4]!.a.length = 3;
console.log(JSON.stringify(lists.slice(0, 7)), lists[39]!.a.length, 0 in lists[5]!.a);
