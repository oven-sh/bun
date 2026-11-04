// a rope is a computed key in the turn held by a variable too
const seen: Record<string, number> = {};
const map = new Map<string, number>();
const set = new Set<string>();
const held = { text: "" };
let kept = "";
function made(n: number): string {
  return "abcdefgh".repeat(n) + String(n) + "ijklmnop".repeat(n);
}
function equalKey(n: number): string {
  return ["abcdefgh".repeat(n), String(n), "ijklmnop".repeat(n)].join("");
}
function churn() {
  Bun.gc(true);
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += ("\u0100" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3) + ("y" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3);
  return sum;
}
function digest(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
    if ((i & 255) === 7) {
      h = (h + (Object.keys({ [s]: 1 }).length)) | 0;
      h = (h + churn()) | 0;
    }
  }
  return h;
}
function run(n: number) {
  seen[equalKey(n)] = 7;
  kept = made(n);
  return digest(kept);
}
console.log(run(100), run(101), run(150), kept.length);
