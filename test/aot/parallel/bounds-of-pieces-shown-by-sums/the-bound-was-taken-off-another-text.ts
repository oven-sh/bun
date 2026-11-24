function made(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i * 7) % 11); return s; }
function pieces(text: string, other: string, width: number): string {
  const out: string[] = [];
  const n = other.length - width + 1;
  for (let i = 0; i < n; i++) out.push(text.substring(i, i + width));
  return out.length + ":" + out.join(",");
}
function shrinking(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; i < n; i++) { out.push(text.substring(i, i + width)); if (i === 2) text = text.slice(0, 5); }
  return out.length + ":" + out.join(",");
}
console.log(1, pieces(made(6), made(10), 1), pieces(made(10), made(6), 1), shrinking(made(10), 1));
console.log(2, pieces(made(6), made(10), 2), pieces(made(10), made(6), 2), shrinking(made(10), 2));
console.log(3, pieces(made(6), made(10), 3), pieces(made(10), made(6), 3), shrinking(made(10), 3));
