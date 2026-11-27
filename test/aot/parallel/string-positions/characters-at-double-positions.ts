// Characters of strings read at positions that are doubles: a captured variable, a field and a parameter, whole, fractional, NaN, infinite, negative and beyond 32 and 64 bits.
const positions: number[] = [0, 1, 3, 0.5, 2.75, -0.5, -0, -1, -1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967296, 4294967299.5, 9007199254740993, 9.3e18, -9.3e18, 1e300, 5e-324, 4.999];
const strings: string[] = ["abcde", "hé✓l\u{1f600}", ["ab", "cd"].map(x => x + x).join("-"), "0123456789".slice(2, 8), "q", ""];
class Reader {
  at = 0;
  constructor(readonly text: string) {}
  code(): number { return this.text.charCodeAt(this.at); }
  point(): number | undefined { return this.text.codePointAt(this.at); }
  character(): string { return this.text.charAt(this.at); }
  counted(): string | undefined { return this.text.at(this.at); }
}
function scan(text: string, starts: number[]): string {
  let at = 0, said = "";
  const step = () => { at += 1; };
  for (const start of starts) {
    at = start;
    for (let k = 0; k < 3; k++) {
      const code = text.charCodeAt(at);
      said += code === 113 ? "q" : code === code ? String(code) : "-";
      said += text.charAt(at) + (text[at] ?? "!");
      step();
    }
    said += ",";
  }
  return said;
}
function hash(text: string): number { let h = 0; for (let k = 0; k < text.length; k++) h = (Math.imul(h, 31) + text.charCodeAt(k)) | 0; return h; }
for (let t = 0; t < 3; t++) {
  for (const text of strings) {
    const reader = new Reader(text), line: string[] = [];
    for (const position of positions) {
      reader.at = position;
      line.push(reader.code() + "/" + reader.point() + "/" + reader.character() + "/" + reader.counted());
      reader.at += 0.25;
      line.push(String(reader.code()));
    }
    const said = scan(text, positions);
    if (t === 2) console.log(line.join(" "), hash(said), said.slice(0, 60));
  }
}
export {};
