// One short string appended to an open buffer is copied by compiled code. Every length from 0 to 18 is appended, and among the pieces are undefined, null, numbers, booleans, strings of 16 bits, ropes and slices.
// IR= 2 byCharacter  = StringBuilderBegin
// IR= 1 byPiece  = StringBuilderBegin
// IR= 1 byString  = StringBuilderBegin
type Piece = string | undefined | null | number | boolean;
function byCharacter(text: string, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += text[i];
  return out;
}
function byPiece(pieces: Piece[]): string {
  let out = "";
  for (const piece of pieces) out += piece;
  return out;
}
function byString(pieces: string[]): string {
  let out = "";
  for (const piece of pieces) out += piece;
  return out;
}
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label, text.length, hash, JSON.stringify(text.length <= 70 ? text : text.slice(0, 33) + ".." + text.slice(-33)));
}
const flat = ["", "a", "bc", "def", "ghij", "klmno", "pqrstu", "vwxyzAB", "CDEFGHIJ", "KLMNOPQRS", "TUVWXYZ012", "3456789abcd", "efghijklmnop", "qrstuvwxyzABC", "DEFGHIJKLMNOPQ", "RSTUVWXYZ012345", "6789abcdefghijkl", "mnopqrstuvwxyzABC", "DEFGHIJKLMNOPQRSTU"];
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const slices = flat.map((_, length) => alphabet.slice(length, length * 2));
const ropes = flat.map((piece, index) => piece + flat[flat.length - 1 - index]);
for (const build of [byString]) {
  show("flat", build(flat));
  show("flat, the longest first", build([...flat].reverse()));
  show("slices", build(slices));
  show("ropes", build(ropes));
  show("latin-1", build(["x", "é", "ÿþ", "çà¡", "x"]));
  show("16 bits in the middle", build(["ab", "c", "日", "de", "本語", "f", "ghijklmnop"]));
  show("16 bits first", build(["日", "a", "bc"]));
  show("one piece", build(["alone"]));
  show("two pieces", build(["a", "b"]));
  show("none", build([]));
  show("only empty ones", build(["", "", ""]));
  for (const piece of flat) show("repeated " + piece.length, build(new Array<string>(300).fill(piece)));
}
for (const build of [byPiece]) {
  show("mixed", build(["a", undefined, "b", null, "c", 1, "d", -0, "e", 1.5, "f", true, "g", false, NaN, 1e21, "h"]));
  show("not a string first", build([undefined, "a", "b"]));
  show("not a string second", build(["a", null, "b"]));
  show("no strings", build([1, 2, undefined]));
}
for (const build of [byCharacter]) {
  show("characters", build(alphabet, alphabet.length));
  show("past the end", build("abc", 6));
  show("characters of 16 bits", build("a日b本c", 5));
  show("characters of a rope", build(alphabet + flat[18], 54));
  show("nothing", build(alphabet, 0));
}
