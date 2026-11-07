// A literal looked for backward from the start.
const word = process.argv.length > 99 ? "never" : ".ts";
const texts: string[] = ["", ".", "..", ".t", ".ts", ".tsx", "ts", "x.ts", "t.", "é.ts", ".é", "日本", ".日本", "日.", "x".repeat(40) + ".ts", ".ts" + "x".repeat(40)];
const ropes: string[] = [word + texts[5], texts[1] + word, texts[11] + word, word + texts[11], texts[0] + word];
const slices: string[] = [(word + "xyz").slice(0, 3), ("ab" + word).slice(2), ("ab" + word).slice(1), (texts[12] + word).slice(0, 2), (word + word).slice(3, 4)];
const all = texts.concat(ropes, slices);

let digest = 0;
const wrong: string[] = [];
function check(name: string, index: number, found: number, starts: boolean): void {
  if (found !== (starts ? 0 : -1)) wrong.push(`${name} ${index} ${found}`);
  digest = (digest * 31 + found + 2) | 0;
}
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < all.length; i++) {
    const text = all[i];
    check("dot", i, text.lastIndexOf(".", 0), text.startsWith("."));
    check("two", i, text.lastIndexOf(".t", 0), text.startsWith(".t"));
    check("three", i, text.lastIndexOf(".ts", 0), text.startsWith(".ts"));
    check("empty", i, text.lastIndexOf("", 0), true);
    check("latin", i, text.lastIndexOf("é", 0), text.startsWith("é"));
    check("wide", i, text.lastIndexOf("日", 0), text.startsWith("日"));
    check("mixed", i, text.lastIndexOf(".日", 0), text.startsWith(".日"));
    check("long", i, text.lastIndexOf("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.", 0), text.startsWith("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx."));
    check("negative", i, text.lastIndexOf(".", -5), text.startsWith("."));
    check("nan", i, text.lastIndexOf(".", -0), text.startsWith("."));
    digest = (digest * 31 + text.lastIndexOf(".", 1) + text.lastIndexOf(".ts", 2) * 3 + text.lastIndexOf(".") * 5 + text.indexOf(".", 0) * 7 + text.indexOf(".ts", 0) * 11 + text.indexOf("", 0) * 13) | 0;
    if (text.lastIndexOf(".", 0) === 0) digest ^= 1;
    if (text.lastIndexOf(".ts", 0) !== 0) digest ^= 2;
    if (text.lastIndexOf(".ts", 0) >= 0) digest ^= 4;
  }
}
console.log(all.length, digest, wrong.length, wrong.slice(0, 8).join("|"));
