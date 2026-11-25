// STATISTIC: LoopsReversionedForOtherIndexingType >= 8
// STATISTIC: LocalArrayMethodEffectsNarrowed >= 20
// Loops that push the elements of a list of numbers, or numbers made of them, onto arrays made here: int32s, doubles, boxed numbers and undefined, a list that grows while it is walked, the array that is filled itself.
function shown(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : typeof x + ":" + String(x); }
function show(list: unknown[]): string { const parts: string[] = []; for (let i = 0; i < list.length; i++) parts.push(i in list ? shown(list[i]) : "hole"); return parts.join(","); }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: number[]): number[] { const all: number[][] = [x, [0]]; return all[late]!; }

function same(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n); return show(more); }
function plus(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n + 1); return show(more); }
function half(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n * 0.5); return show(more); }
function above(list: number[]): string { const more: number[] = []; for (const n of list) if (n > 4) more.push(n); return show(more); }
function aboveByIndex(list: number[]): string { const more: number[] = []; for (let i = 0; i < list.length; i++) { const n = list[i]!; if (n > 4) more.push(n); } return show(more); }
function parted(list: number[]): string { const a: number[] = [], b: number[] = []; for (const n of list) { if (n > 4) a.push(n); else b.push(n); } return show(a) + "|" + show(b); }
function sums(list: number[]): string { const more: number[] = []; let s = 0; for (const n of list) { s += n; more.push(s); } return show(more); }
function stacked(list: number[]): string { const stack: number[] = []; let t = 0; for (const n of list) { if (n & 1 && stack.length > 0) t += stack.pop()! & 255; else stack.push(n); } return show(stack) + "|" + t; }
function objects(list: number[]): string { const more: { n: number }[] = []; for (const n of list) more.push({ n }); return show(more.map(m => m.n)); }
function worded(list: number[]): string { const more: string[] = []; for (const n of list) more.push(n > 4 ? "above" : "below"); return show(more); }
function own(list: number[]): string { const more: number[] = [1, 2]; let left = 9; for (const n of more) if (left-- > 0) more.push(n + 1); for (const n of list) more.push(n); return show(more); }
function aliased(list: number[]): string { const more: number[] = [7]; const from = veil(more); let left = 9; for (const n of from) { if (left-- <= 0) break; more.push(n + 1); } return show(more) + show(list); }
function grows(list: number[]): string { const more: number[] = []; let seen = 0; for (const n of list) { more.push(n + 1); if (++seen === 3) list.push(1.25); if (seen > 30) break; } return show(more); }
function widened(list: number[]): string { const more: number[] = [list.length, 2, 3]; const from = veil(more); let s = 0; for (let i = 0; i < from.length && i < 40; i++) { s += from[i]! * 2; if (more.length < 30) more.push(i === 9 ? ("t" as unknown as number) : i); } return show(more) + s; }
function halved(list: number[]): string { const more: number[] = [list.length, 2, 3]; const from = veil(more); let s = 0; for (const n of from) { s += n * 2; if (more.length < 30) more.push(n + 0.5); } return show(more) + s; }
function caught(list: number[]): string { const more: number[] = []; try { for (const n of list) more.push(n + 1); } finally { more.push(-1); } return show(more); }

const texts: [string, string][] = [["ints", "3,8,1,9,5,4,7,2,6"], ["doubles", "0.5,8.25,1.5,9.75,5.5,4.5"], ["one fraction", "3,8,1,9.5,5,4"], ["one NaN", "3,8,1,9,5,x"], ["NaN first", "x,8,1,9,5"], ["undefined", "3,8,u,9,5"], ["undefined last", "3,8,1,9,u"], ["edges", "2147483647,-2147483648,2147483646,1073741824,-1"], ["big", "3,1099511627776,-9007199254740992,8"], ["minus zero", "3,-0,0,8"], ["endless", "3,Infinity,-Infinity,8"], ["empty", ""]];
function read(text: string): number[] { const list: number[] = []; if (text) for (const part of text.split(",")) list.push(part === "u" ? undefined as unknown as number : parseFloat(part)); return list; }
for (const [name, text] of texts) for (let turn = 0; turn < 3; turn++) {
  const said: string[] = [];
  try { said.push("same " + same(read(text))); } catch (error) { said.push("same " + (error as Error).name); }
  try { said.push("plus " + plus(read(text))); } catch (error) { said.push("plus " + (error as Error).name); }
  try { said.push("half " + half(read(text))); } catch (error) { said.push("half " + (error as Error).name); }
  try { said.push("above " + above(read(text))); } catch (error) { said.push("above " + (error as Error).name); }
  try { said.push("aboveByIndex " + aboveByIndex(read(text))); } catch (error) { said.push("aboveByIndex " + (error as Error).name); }
  try { said.push("parted " + parted(read(text))); } catch (error) { said.push("parted " + (error as Error).name); }
  try { said.push("sums " + sums(read(text))); } catch (error) { said.push("sums " + (error as Error).name); }
  try { said.push("stacked " + stacked(read(text))); } catch (error) { said.push("stacked " + (error as Error).name); }
  try { said.push("objects " + objects(read(text))); } catch (error) { said.push("objects " + (error as Error).name); }
  try { said.push("worded " + worded(read(text))); } catch (error) { said.push("worded " + (error as Error).name); }
  try { said.push("own " + own(read(text))); } catch (error) { said.push("own " + (error as Error).name); }
  try { said.push("aliased " + aliased(read(text))); } catch (error) { said.push("aliased " + (error as Error).name); }
  try { said.push("grows " + grows(read(text))); } catch (error) { said.push("grows " + (error as Error).name); }
  try { said.push("widened " + widened(read(text))); } catch (error) { said.push("widened " + (error as Error).name); }
  try { said.push("halved " + halved(read(text))); } catch (error) { said.push("halved " + (error as Error).name); }
  try { said.push("caught " + caught(read(text))); } catch (error) { said.push("caught " + (error as Error).name); }
  if (turn !== 1) for (const line of said) console.log(name, line);
}
