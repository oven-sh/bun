function made(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i * 7) % 11); return s; }
function pieces(text: string, width: number): string {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    if (i + width > text.length) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function late(text: string, width: number): string {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    if (i + width > text.length + 1) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function turned(text: string, width: number): string {
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    if (i + width <= text.length) continue;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
console.log(1, pieces(made(10), 1), late(made(10), 1), turned(made(10), 1));
console.log(2, pieces(made(10), 2), late(made(10), 2), turned(made(10), 2));
console.log(3, pieces(made(10), 3), late(made(10), 3), turned(made(10), 3));
console.log(9, pieces(made(10), 9), late(made(10), 9), turned(made(10), 9));
console.log(10, pieces(made(10), 10), late(made(10), 10), turned(made(10), 10));
console.log(11, pieces(made(10), 11), late(made(10), 11), turned(made(10), 11));
