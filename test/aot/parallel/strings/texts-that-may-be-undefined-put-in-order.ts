// The four relations where an operand is a character read from a text, which is undefined beyond its end, or an element of a list of texts.
// undefined is compared as NaN: no relation holds with it. The functions are too large to be inlined, so their parameters are what the callers may pass.
const lines: string[] = [];
function isWordCharacter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "/" || c === "." || c === "-" || c === "+" || c === ":" || c === "@" || c === "%" || c === "," || c === "~" || c === "^" || c === "?" || c === "*" || c === "!" || c === "=" || c === "[" || c === "]";
}
function relations(c: string): string {
  let bits = "";
  bits += c < "m" ? "1" : "0"; bits += c <= "m" ? "1" : "0"; bits += c > "m" ? "1" : "0"; bits += c >= "m" ? "1" : "0";
  bits += "m" < c ? "1" : "0"; bits += "m" <= c ? "1" : "0"; bits += "m" > c ? "1" : "0"; bits += "m" >= c ? "1" : "0";
  bits += c < "" ? "1" : "0"; bits += c <= "" ? "1" : "0"; bits += c > "" ? "1" : "0"; bits += c >= "" ? "1" : "0";
  bits += c < "mm" ? "1" : "0"; bits += c <= "mm" ? "1" : "0"; bits += c > "mm" ? "1" : "0"; bits += c >= "mm" ? "1" : "0";
  bits += c < "é" ? "1" : "0"; bits += c >= "é" ? "1" : "0"; bits += c < "中" ? "1" : "0"; bits += c >= "中" ? "1" : "0";
  bits += c < "0" ? "1" : "0"; bits += c <= "0" ? "1" : "0"; bits += c > "0" ? "1" : "0"; bits += c >= "0" ? "1" : "0";
  bits += !(c < "m") ? "1" : "0"; bits += !(c >= "m") ? "1" : "0";
  return bits;
}
function between(a: string, b: string): string {
  let bits = "";
  bits += a < b ? "1" : "0"; bits += a <= b ? "1" : "0"; bits += a > b ? "1" : "0"; bits += a >= b ? "1" : "0";
  bits += b < a ? "1" : "0"; bits += b <= a ? "1" : "0"; bits += b > a ? "1" : "0"; bits += b >= a ? "1" : "0";
  return bits;
}
const texts: string[] = ["", "a", "m", "z", "mm", "ml", "mn", "M", "0", "00", "9", "_", "é", "中", "中m", "m中", "😀", "left " + "right".repeat(2), ("xxm" + "yy".repeat(3)).slice(2), ("xxm" + "yy".repeat(3)).slice(2, 3)];
for (let i = 0; i <= texts.length; i++) lines.push(i + " " + relations(texts[i]) + " " + isWordCharacter(texts[i]));
const text = "git commit -m 'Fix 42' && ls /usr | grep X_9zé中";
let counted = "";
for (let i = -1; i <= text.length + 1; i++) counted += isWordCharacter(text[i]) ? "w" : ".";
lines.push(counted);
for (let i = 0; i <= texts.length; i += 3) for (let j = 0; j <= texts.length; j += 2) lines.push(i + "," + j + " " + between(texts[i], texts[j]));
// What a type does not say: the same functions are given other values.
const others: unknown[] = [undefined, null, 0, 1, -1, 109, NaN, true, false, 10n, {}, [], ["m"], { valueOf() { return "n"; } }, { toString() { return "a"; } }, Symbol.iterator];
for (const other of others) {
  try { lines.push(typeof other + " " + relations(other as string) + " " + isWordCharacter(other as string) + " " + between(other as string, "m") + " " + between("0", other as string)); } catch (error) { lines.push(typeof other + " " + (error as Error).constructor.name); }
}
console.log(lines.join("\n"));
