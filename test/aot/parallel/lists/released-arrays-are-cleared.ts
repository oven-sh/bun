// An array that a function lets go serves as the next one: what it held is gone, for every length, for whole numbers, fractions and strings.
function ints(n: number): number[] { const out: number[] = []; for (let i = 0; i < n; i++) out.push(i + 1); return out; }
function halves(n: number): number[] { const out: number[] = []; for (let i = 0; i < n; i++) out.push(i + 0.5); return out; }
function texts(n: number): string[] { const out: string[] = []; for (let i = 0; i < n; i++) out.push("t" + i); return out; }
function holes(list: unknown[], length: number): string { list.length = length; let text = ""; for (let i = 0; i < length; i++) text += i in list ? String(list[i]) : "-"; return text; }
const said: string[] = [];
for (let n = 0; n < 12; n++) {
  let sum = 0, fractions = 0, letters = 0;
  for (let turn = 0; turn < 40; turn++) { sum += ints(n).length + (ints(n)[n - 1] ?? 0); fractions += halves(n).length + (halves(n)[0] ?? 0); letters += texts(n).join("").length; }
  said.push([sum, fractions, letters, holes(ints(n >> 1), n), holes(halves(n >> 1), n), holes(texts(n >> 1), n)].join(" "));
}
console.log(said.join("\n"));
