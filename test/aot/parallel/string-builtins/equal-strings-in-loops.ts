// == and === of strings and of strings with other values, in loops: flat strings, ropes, pieces, wide strings, atoms, the same string twice, and what is no string.
const wide = "日";
const word = "identifier";
const join = (a: string, b: string): string => a + b;
const texts: any[] = ["", "a", "b", "ab", "ba", word, word.toUpperCase().toLowerCase(), join("ident", "ifier"), ("(" + word + ")").slice(1, -1), join(wide, "ab").slice(1), wide, wide + wide, join(wide, wide), (wide + wide + "x").slice(0, 2),
  "\ud83d", "😀", "\ude00", join("\ud83d", "\ude00"), "ÿ", "\u0000", "\u0000\u0000", "x".repeat(31), "x".repeat(32), "x".repeat(33), "x".repeat(32) + "y", join("x".repeat(16), "x".repeat(17)), ("a" + "x".repeat(33)).slice(1),
  (wide + "x".repeat(33)).slice(1), "x".repeat(70), join("x".repeat(35), "x".repeat(35)), "x".repeat(69) + "y", "12", "1", "0", "-0", "true", "null", "undefined", "NaN"];
const others: any[] = [undefined, null, true, false, 0, -0, 1, 12, 1.5, NaN, Infinity, 12n, 0n, Symbol("a"), { toString: () => "a" }, ["a"], new String("ab"), new String("identifier"), () => "a", /a/, [12]];
let digest = 0;
const add = (value: boolean, weight: number) => {
  digest = (Math.imul(digest, 33) + (value ? weight : 1)) | 0;
};
function strict(list: any[], wanted: any): number {
  let count = 0;
  for (const text of list) {
    if (text === wanted) count++;
    if (wanted !== text) count += 3;
  }
  return count;
}
function neighbors(list: any[]): number {
  let count = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i] === list[i - 1]) count++;
    else if (list[i - 1] == list[i]) count += 5;
  }
  return count;
}
function strings(list: string[], wanted: string): number {
  let count = 0;
  const key = wanted + "";
  for (const text of list) {
    const known = text + "";
    if (known === key) count++;
    if (known == key) count += 7;
    add(known === key, count);
    if (key.slice(1) === known.slice(1)) count += 11;
  }
  return count;
}
function kept(list: any[], wanted: any): boolean[] {
  const out: boolean[] = [];
  for (const text of list) out.push(text === wanted, text == wanted);
  return out;
}
const all = [...texts, ...others];
for (let turn = 0; turn < 2; turn++) {
  for (const wanted of all) {
    let line = typeof wanted + " " + strict(all, wanted) + " " + strict(texts, wanted) + " " + kept(all, wanted).map(Number).join("");
    if (typeof wanted === "string") line += " " + strings(texts, wanted);
    console.log(line, neighbors([wanted, ...all, wanted, wanted]), digest);
  }
}
