function made(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i * 7) % 11); return s; }
function inside(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; ; i++) {
    if (i >= n) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function late(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; ; i++) {
    if (i > n) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function outside(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; i < 14; i++) {
    if (i < n) continue;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
console.log(1, inside(made(10), 1), late(made(10), 1), outside(made(10), 1));
console.log(2, inside(made(10), 2), late(made(10), 2), outside(made(10), 2));
console.log(3, inside(made(10), 3), late(made(10), 3), outside(made(10), 3));
console.log(9, inside(made(10), 9), late(made(10), 9), outside(made(10), 9));
console.log(11, inside(made(10), 11), late(made(10), 11), outside(made(10), 11));
