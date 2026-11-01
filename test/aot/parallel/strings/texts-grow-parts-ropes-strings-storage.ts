// A string that is looked up as a property key takes the storage of the equal key that is there, of either width. Parts of it and ropes that hold it were made before, and are appended to texts afterwards.
const keys: Record<string, number> = {};
const in16Bits = (text: string): string => Buffer.from(text, "utf16le").toString("utf16le");
const in8Bits = (text: string): string => Buffer.from(text, "latin1").toString("latin1");
function becomes16Bit(text: string): string {
  keys[in16Bits(text)] = 1;
  return in8Bits(text);
}
function lookUp(text: string): void {
  if (keys[text] !== 1) console.log("no key " + text);
}
function query(text: string, name: string): string {
  const q = new URLSearchParams(text);
  return q.get(name) + "|" + q.has("cc") + "|" + q.size;
}
function queryKeys(text: string): string {
  const q = new URLSearchParams(text);
  let all = "";
  for (const [key, value] of q) all += key + "=" + value + ";";
  return all;
}
function template(a: string, piece: string, b: number): string {
  return `${a}-${piece}-${b}`;
}
function plus(a: string, piece: string, b: number): string {
  return a + "[" + piece + "]" + b;
}
function grown(pieces: string[]): string {
  let s = "";
  for (const piece of pieces) s += piece + ",";
  return s;
}
function grownLong(piece: string, turns: number): string {
  let s = "start:";
  for (let i = 0; i < turns; i++) s += piece;
  return s;
}
function json(piece: string): string {
  return JSON.stringify({ a: piece, b: [piece] });
}
for (let round = 0; round < 3; round++) {
  const tag = "r" + round + "x";
  {
    const whole = becomes16Bit("<<aa=1&bb=22&cc=333&" + tag + "=4>>");
    const parts = [0, 1, 2, 3, 4, 5, 6, 7].map(() => whole.slice(2, -2));
    const names = [0, 1].map(() => whole.slice(7, 9));
    lookUp(whole);
    console.log("query", query(parts[0], "bb"), query(parts[1], names[0]), queryKeys(parts[2]));
    console.log("template", template("a", parts[3], round), plus("a", parts[4], round));
    console.log("grown", grown([parts[5], "x", parts[5]]), grownLong(parts[6], 3));
    console.log("json", json(parts[7]));
  }
  {
    const left = becomes16Bit("left-" + tag + "-part");
    const right = in8Bits("|right-" + tag);
    const ropes = [0, 1, 2, 3, 4, 5].map(() => left + right);
    const three = [0, 1, 2].map(() => right + left + right);
    lookUp(left);
    console.log("rope template", template("a", ropes[0], round), plus("a", ropes[1], round));
    console.log("rope grown", grown([ropes[2], "x"]), grownLong(ropes[3], 3));
    console.log("rope json", json(ropes[4]), ropes[5].length, ropes[5]);
    console.log("rope of three", template("a", three[0], round), grown([three[1]]), three[2]);
  }
}
