const seen: string[] = [];
function use(text: string) {
  seen.push(text);
}
function sumOf(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return sum;
}
function tell() {
  console.log(seen.length, seen.map(text => text.length + ":" + sumOf(text)).join(" "));
  console.log(JSON.stringify(seen[0]), JSON.stringify(seen[seen.length - 1].slice(-12)));
}
const table: Record<string, number> = { x1x: 1, x1x1x: 2, other: 3 };
function row(a: string, n: number): number {
  let s = a;
  s = s + n + a;
  use(s);
  const first = table[s];
  s = s + n + a;
  use(s);
  const second = table[s];
  s = s + n + a;
  use(s);
  use("x1x1x");
  return first * 10 + second + (table[s] === undefined ? 100 : 0) + (s === "x1x1x1x" ? 1000 : 0);
}
console.log(row("x", 1));
tell();
