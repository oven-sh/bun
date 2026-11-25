// Sums whose operands nobody knows: a string of every kind beside integers small, large and negative, on either side.
const texts: any[] = ["", "a", "label", "é✓", "abcdefgh".slice(2, 5), "x".repeat(40) + "y", JSON.parse('"parsed"')];
const values: any[] = [0, 1, 9, 10, 99, 1022, 1023, 1024, 1025, -1, -0, -1024, 2147483647, -2147483648, 0.5, NaN, null, undefined, true, "", "t", 7n, [1, 2], { valueOf() { return 4; } }];
function add(left: any, right: any): any { return left + right; }
function label(text: any, value: any): any { return text + ":" + value + "/" + value; }
let h = 0;
for (let t = 0; t < 4; t++) {
  for (const text of texts) {
    const line: string[] = [];
    for (const value of values) {
      for (const made of [add(text, value), add(value, text), label(text, value), add(add(text, value), value)]) {
        const said = String(made);
        for (let k = 0; k < said.length; k++) h = (Math.imul(h, 31) + said.charCodeAt(k)) | 0;
        if (t === 3 && said.length < 12) line.push(said);
      }
    }
    if (t === 3) console.log(line.join(" "));
  }
  for (const value of values) for (const other of values) { try { h = (h + String(add(value, other)).length) | 0; } catch (error) { h = (h * 3 + (error as Error).name.length) | 0; } }
}
let grown: any = texts[1];
for (let i = 0; i < 2000; i++) { grown = grown + (i & 2047); if (grown.length > 500) grown = texts[i % 7] + i; }
console.log(h, grown.length, grown.slice(-12));
export {};
