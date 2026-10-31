// A string that a loop appends to takes each form of part: integers and numbers near powers of ten, constants at and over the inline limit, strings of every internal representation, a rope, an initial value, and lengths just under and over each size limit of the builder.
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label + ": " + text.length + " " + hash + " " + JSON.stringify(text.length <= 90 ? text : text.slice(0, 40) + ".." + text.slice(-40)));
}
function doubled(times: number): string { let text = "x"; for (let i = 0; i < times; i++) text = text + text; return text; }
function nearPowersOfTen(): number[] { const values = [2147483647, -2147483648]; for (let power = 1; power <= 1e9; power *= 10) values.push(power - 1, power, power + 1, 1 - power, -power, -power - 1); return values; }
function integerParts(values: number[]): string { let s = ""; for (const value of values) s += "<" + (value | 0) + ">"; return s; }
function numberParts(values: number[]): string { let s = ""; for (const value of values) s += value + ";"; return s; }
function constantParts(n: number): string { let s = ""; for (let i = 0; i < n; i++) { s += "0123456789abcdef"; s += "|"; s += "0123456789abcdefg"; s += ""; s += "\u00e9"; } return s; }
function constantAtInlineLimit(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += "0123456789abcdef"; return s; }
function constantOverInlineLimit(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += "0123456789abcdefg"; return s; }
function nonASCIIConstant(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += "\u00e9"; return s; }
function stringParts(parts: string[], rounds: number): string { let s = ""; for (let round = 0; round < rounds; round++) for (const part of parts) s += part + "|"; return s; }
function ropeAsThirdPart(rope: string, n: number): string { let s = ""; for (let i = 0; i < n; i++) s += "<" + i + rope + ">"; return s; }
function appendsToInitialValue(initial: string, n: number): string { let s = initial; for (let i = 0; i < n; i++) s += i; return s; }
function partLengthSweep(text: string): string {
  let s = "";
  for (let size = 2; size <= 131072; size *= 2) for (let length = size - 2; length <= size + 1; length++) { s += text.slice(0, length); s += "|"; s += appendsToInitialValue(text.slice(0, length), 1); s += "|"; }
  return s;
}
show("integer parts", integerParts(nearPowersOfTen()));     show("number parts", numberParts([...nearPowersOfTen(), 1.5, -0, 0.1 + 0.2, 1e21, 1e-7, NaN, Infinity, -Infinity, 4294967296]));
show("constant parts", constantParts(300));                 show("a rope as the third part", ropeAsThirdPart(doubled(3), 40));
show("a 16-character constant", constantAtInlineLimit(300)); show("a 17-character constant", constantOverInlineLimit(300)); show("a non-ASCII constant", nonASCIIConstant(300));
const latin1Parts = ["", "a", "0123456789abcdef", "0123456789abcdefg", doubled(3), doubled(5), "0123456789abcdefghij".slice(2, 12), "\u00e9\u00ff"];
show("Latin-1 string parts", stringParts(latin1Parts, 60)); show("16-bit string parts", stringParts([...latin1Parts, "\u8a9eabcd".slice(1), "\u8a9e", "\u{1F600}"], 60));
show("one string alone", appendsToInitialValue("alone", 0)); show("part lengths near powers of two", partLengthSweep("0123456789".repeat(13200)));
export {};
