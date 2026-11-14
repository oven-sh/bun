// Ropes of two to thirty parts, of every width and length, resolved by a read of one character, a search, a key, and JSON; and split() of every kind of string.
const wide = "本";
const pieceOf = (text: string, a: number, b: number): string => text.slice(a, b);
const parts: string[] = ["", "a", "bc", "def", "ghij", "klmnopq", "rstuvwxy", "0123456789abcde", "0123456789abcdef", "0123456789abcdefg", "x".repeat(40), "ÿé", wide, "\ud83d", "\ude00", pieceOf("(piece of a string)", 1, 18), pieceOf("[ab]", 1, 3), pieceOf(wide + "narrow" + wide, 1, 7)];
let digest = 0;
const add = (text: string) => {
  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
  digest = (digest + text.length) | 0;
};
function template(a: string, b: string, c: string, d: string, n: number): string {
  return `${a}:${b}:${n}/${c}${d}`;
}
function four(a: string, b: string, n: number): string {
  return "user:" + a + ":" + n + b;
}
const seen = new Map<string, number>();
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < parts.length; i++) {
    for (let k = 0; k < parts.length; k++) {
      const t = template(parts[i], parts[k], parts[(i + k) % parts.length], parts[(i * 7) % parts.length], i * 1000 + k);
      add(String(t.charCodeAt(t.length - 1)));
      add(t);
      const f = four(parts[i], parts[k], (k - 9) * 123456789);
      add(String(f.indexOf(":") + f.lastIndexOf(":")));
      add(f);
      const g = four(parts[k], parts[i], k) + template(parts[k], "", "", parts[i], 0) + wide.slice(1);
      seen.set(g, (seen.get(g) ?? 0) + 1);
      add(g);
      let chain = parts[i];
      for (let m = 0; m < 9; m++) {
        chain = m & 1 ? chain + parts[k] : parts[k] + chain;
        add(String(chain.codePointAt(chain.length >> 1)));
      }
      let left = "";
      for (let m = 0; m < 12; m++) left += parts[(k + m) % parts.length] + m;
      add(left);
      for (const separator of ["", "/", ":", "a", "ab", "ÿ", wide, "\ud83d", "0123", "zz"]) {
        for (const text of [t, f, left, pieceOf("<" + f + ">", 1, f.length + 1), parts[i]]) {
          const pieces = text.split(separator);
          add(pieces.length + "|" + pieces.join(","));
          const limited = text.split(separator, 2);
          add(limited.length + "|" + limited.join(","));
          if (pieces.join(separator) !== text) console.log("split", JSON.stringify(text), JSON.stringify(separator));
        }
      }
    }
    console.log(i, digest, seen.size);
  }
}
const lines = ("alpha,beta,,gamma\n".repeat(50) + wide).split("\n");
let cells = 0;
for (const line of lines) for (const cell of line.split(",")) cells += cell.length + (cell === "beta" ? 1000 : 0);
console.log(lines.length, cells, ",".repeat(40).split(",").length, "abc".split("abc"), "abc".split("abcd"), "".split(","), "".split(""), "a,b,c".split(",", 0), "a,b,c".split(",", 2 ** 32 - 1), "a,b,c".split(undefined as any), "aXbX".split("X", -1));
