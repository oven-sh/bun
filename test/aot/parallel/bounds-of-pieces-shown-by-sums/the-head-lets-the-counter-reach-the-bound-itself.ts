function made(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i * 7) % 11); return s; }
function pieces(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; i <= n; i++) out.push(text.substring(i, i + width));
  return out.length + ":" + out.join(",");
}
function more(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; i < n + 2; i++) out.push(text.substring(i, i + width));
  return out.length + ":" + out.join(",");
}
console.log(1, pieces(made(10), 1), more(made(10), 1));
console.log(2, pieces(made(10), 2), more(made(10), 2));
console.log(3, pieces(made(10), 3), more(made(10), 3));
console.log(9, pieces(made(10), 9), more(made(10), 9));
console.log(10, pieces(made(10), 10), more(made(10), 10));
