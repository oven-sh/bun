// a piece of a wide text is looked for with in in the turn held by a variable too
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
function digest(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
    if ((i & 255) === 7) {
      h = (h + (s in seen ? 1 : 0)) | 0;
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
