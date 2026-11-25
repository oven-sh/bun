// Searches, comparisons, lengths and numbers of pieces of strings, read in loops. Pieces are cut from flat strings, ropes, pieces and wide strings.
const wide = "日本";
const lead = "\ud83d";
const trail = "\ude00";
const makeRope = (a: string, b: string): string => a + b;
const bases: string[] = [
  "",
  "a",
  "ab",
  "x/y z\"q",
  "0123456789/0123456789 0123456789\"0123456789/tail",
  "/" + "-".repeat(15) + "/" + "-".repeat(16) + " " + "-".repeat(33) + "\"" + "/",
  "café/naïve \"ÿ\"",
  wide + "/a b" + wide + "\"/",
  lead + "/" + trail + " " + lead + trail + "\"",
  makeRope("left part/", "right part \"end"),
  makeRope(makeRope("a/b", " c\""), makeRope("/d", " e\"")),
  makeRope("plain/ ", wide + "\""),
  "zz/0123456789abcdef/zz 0123456789abcdef \"" .slice(2),
  (wide + "0123456789/abc def \"ghi\" jkl/mno").slice(2),
  "a".repeat(200) + "/" + "b".repeat(200) + " " + "c".repeat(40),
];
const positions = [0, 1, 2, 3, 5, 8, 9, 15, 16, 17, 31, 32, 33, 60, 200, 4000];
let digest = 0;
const add = (value: number) => {
  digest = (Math.imul(digest, 31) + (value | 0)) | 0;
};
function narrow(lines: string[], a: number, b: number, c: number): string {
  let out = "";
  for (const line of lines) {
    const piece = line.slice(a, b);
    const inner = piece.substring(c, piece.lastIndexOf(" "));
    out += piece.indexOf("/") + "," + piece.indexOf("\"", c) + "," + piece.lastIndexOf("/") + "," + piece.lastIndexOf(" ", c) + "," + inner.length + "," + inner.indexOf("/") + "," + inner.lastIndexOf("/") + "," +
      inner.slice(1).length + "," + (inner === "/d" ? 1 : 0) + "," + (piece.includes("/") ? 1 : 0) + "," + (piece.includes("part") ? 1 : 0) + "," + piece.indexOf("9/0") + "," + piece.lastIndexOf("9 0") + "," + piece.indexOf("é") + "," + piece.indexOf("日") + "," + piece.lastIndexOf("本") + "," + piece.indexOf("\ud83d") + "," + piece.indexOf("\ude00") + ";";
  }
  return out;
}
function negative(lines: string[], a: number, b: number): string {
  let out = "";
  for (const line of lines) {
    const piece = line.slice(-a, -b);
    const again = piece.slice(-5, -1);
    out += piece.length + "," + again.length + "," + again.indexOf("e") + "," + piece.lastIndexOf("e", -1) + "," + piece.lastIndexOf("e", 0) + "," + piece.indexOf("e", -4) + "," + piece.substr(2, 3).indexOf("/") + "," + again.charCodeAt(0) + "," + again.charAt(1) + ";";
  }
  return out;
}
function kept(lines: string[], a: number, b: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const piece = line.substring(a, b);
    const path = piece.substring(1, piece.length - 1);
    if (path.indexOf("/") >= 0) out.push(path, piece);
    else out.push(piece.slice(0, 2));
  }
  return out;
}
function numbers(lines: string[], a: number, b: number): string {
  let out = "";
  for (const line of lines) {
    const piece = line.slice(a, b);
    const digits = piece.slice(1, 4);
    out += parseInt(digits, 10) + "," + parseInt(piece) + "," + Number(digits) + "," + +piece.slice(0, 2) + "," + parseInt(digits, 16) + ";";
  }
  return out;
}
for (const a of positions) {
  for (const b of positions) {
    const texts = [narrow(bases, a, b, 1), negative(bases, b, a), numbers(bases, a, b)];
    for (const c of [0, 2, 16]) texts.push(narrow(bases, a, b, c));
    for (const piece of kept(bases, a, b)) texts.push(piece);
    for (const text of texts) {
      add(text.length);
      for (let i = 0; i < text.length; i++) add(text.charCodeAt(i));
    }
  }
  console.log(a, digest);
}
console.log(narrow(bases, 0, 60, 1));
console.log(negative(bases, 9, 1));
console.log(numbers(bases, 0, 33));
