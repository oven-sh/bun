// A kept position that steps of one alone store and a length bounds is held to an exact integer, from zero up where it only grows: what enters below zero, past an int32, as a fraction or as NaN reads what plain code reads.
// STATISTIC: SlotsCarriedAroundLoops >= 9
const list: number[] = [];
for (let i = 0; i < 20; i++) list.push(i * 3 - 7);
const mixed: number[] = [1.5, 2, 1e10, -0, NaN, 6, 7.25, 8, 9, 10];
const holes: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; delete holes[4];
const bytes = new Uint8Array(20), words = new Int32Array(20);
for (let i = 0; i < 20; i++) { bytes[i] = i * 37; words[i] = i * 0x7654321; }
class Cursor { at = 0; seen = 0; }
const kept: Cursor[] = [new Cursor()];
function sums(o: Cursor, from: number[]): number { let sum = 0; while (o.at < from.length) sum += from[o.at++]; return sum; }
function truncated(o: Cursor, from: number[]): number { let sum = 0; while (o.at < from.length) sum = (sum + from[o.at++]) | 0; return sum; }
function bytesOf(o: Cursor, from: Uint8Array): number { let sum = 0; while (o.at < from.length) sum = (sum * 31 + from[o.at++]) | 0; return sum; }
function wordsOf(o: Cursor, from: Int32Array): number { let sum = 0; while (o.at < from.length) { sum = (sum ^ from[o.at]) | 0; o.at++; } return sum; }
function fills(o: Cursor, to: Uint8Array): string { while (o.at < to.length) to[o.at++] = 200 - o.at; return to.join(); }
function stores(o: Cursor, to: number[]): string { while (o.at < to.length) { to[o.at] = o.at * 2; o.at++; } return to.join(); }
function down(o: Cursor, from: number[]): number { let sum = 0; while (o.at >= 0) sum += from[o.at--] ?? 1000; return sum; }
function bothWays(o: Cursor, from: Uint8Array): number { let sum = 0; for (let k = 0; k < 30; k++) { if (k % 3) o.at++; else o.at--; sum = (sum + from[o.at]) | 0; } return sum; }
function reset(o: Cursor, from: number[]): number { let sum = 0; for (let k = 0; k < 30; k++) { sum = (sum + (from[o.at] ?? 5)) | 0; o.at++; if (k === 9) o.at = -3; if (k === 20) o.at = 2.5; } return sum; }
function shrinks(o: Cursor, from: number[]): number { let sum = 0; while (o.at < from.length) { sum += from[o.at++]; if (o.at === 4) from.length = 6; } return sum; }
function start(at: number): Cursor { const o = kept[0]; o.at = at; return o; }
function show(name: string, answer: number | string): void { console.log(name, Object.is(answer, -0) ? "-0" : answer, Object.is(kept[0].at, -0) ? "-0" : kept[0].at); }
function all(at: number): void {
  const near = at > -100;
  if (near) { show("sums", sums(start(at), list)); show("mixed", sums(start(at), mixed)); show("holes", sums(start(at), holes)); show("truncated", truncated(start(at), list)); show("truncated mixed", truncated(start(at), mixed)); show("bytes", bytesOf(start(at), bytes)); show("words", wordsOf(start(at), words)); show("fills", fills(start(at), new Uint8Array(6))); if (at >= 0) show("stores", stores(start(at), [9, 9, 9, 9])); show("shrinks", shrinks(start(at), [1, 2, 3, 4, 5, 6, 7, 8])); }
  if (at < 100) show("down", down(start(at), list));
  show("both ways", bothWays(start(at), bytes)); show("reset", reset(start(at), list));
}
all(0); all(3); all(-1); all(-5); all(19); all(20); all(2147483646); all(2147483647); all(2147483648); all(-2147483648); all(4294967295); all(9007199254740990); all(0.5); all(-0); all(NaN); all(7);
for (let k = 0; k < 40; k++) { start(k & 3); kept[0].seen += truncated(kept[0], list) + bytesOf(start(1), bytes); }
console.log(kept[0].seen);
