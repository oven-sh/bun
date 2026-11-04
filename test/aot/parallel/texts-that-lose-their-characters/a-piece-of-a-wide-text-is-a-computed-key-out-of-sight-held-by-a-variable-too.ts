// a piece of a wide text is a computed key out of sight held by a variable too
const seen: Record<string, number> = {};
const map = new Map<string, number>();
const set = new Set<string>();
const held = { text: "" };
let kept = "";
function made(n: number): string {
  return ("\u0100" + "abcdefgh".repeat(n)).slice(1);
}
function equalKey(n: number): string {
  return "abcdefgh".repeat(n);
}
function churn() {
  Bun.gc(true);
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += ("\u0100" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3) + ("y" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3);
  return sum;
}
(globalThis as any).hidden = function (): number {
  const text = held.text;
  held.text = "";
  if (!text) return 0;
  return Object.keys({ [text]: 1 }).length;
};
function digest(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
    if ((i & 255) === 7) h = (h + (globalThis as any).hidden() + churn()) | 0;
  }
  return h;
}
function run(n: number) {
  seen[equalKey(n)] = 7;
  held.text = made(n);
  kept = held.text;
  return digest(held.text);
}
console.log(run(100), run(101), run(150), kept.length);
