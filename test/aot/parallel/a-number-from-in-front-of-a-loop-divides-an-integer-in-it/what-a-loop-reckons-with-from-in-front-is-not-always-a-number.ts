// A loop subtracts and multiplies with two values that were read in front of it. Now and then they are no numbers: a text, nothing, an object that counts or throws when it is asked for
// its value, a big integer, a symbol. Each is turned into a number as often, and in the order, in which plain Bun does it, and what throws there throws here.
const out: string[] = [], J = JSON.parse, hide = (x: any): any => [x][J("0")];
let log: string[] = [];
const say = (name: string, f: () => unknown): void => { log = []; try { const v = f(); out.push(name + " " + typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) + " | " + log.join(",")); } catch (e: any) { out.push(name + " threw " + (e && e.name) + " " + (e && e.message) + " | " + log.join(",")); } };
const rows = (): any[] => J("[[1.5,2.5],[4.25,5.25],[7.125,8.125],[0.5,0.25]]");
const odd: Record<string, () => any> = {
  fraction: () => 2.5, whole: () => 3, zero: () => -0, nan: () => NaN, text: () => "4.5", word: () => "x", empty: () => "", nothing: () => undefined, none: () => null, yes: () => true,
  counts: () => { let n = 0; return { valueOf() { log.push("valueOf " + ++n); return n; } }; },
  throws: () => ({ valueOf() { log.push("valueOf throws"); throw new RangeError("no value"); } }),
  late: () => { let n = 0; return { valueOf() { if (++n > 2) { log.push("late throw"); throw new EvalError("third"); } log.push("ok " + n); return 1.5; } }; },
  primitive: () => ({ [Symbol.toPrimitive](hint: string) { log.push("hint " + hint); return 6.5; } }),
  list: () => [7.5], big: () => 5n, symbol: () => Symbol("s"), date: () => new Date(86400000),
};
function pairs(points: any, centers: any): any { let sum: any = 0; for (let at = 0; at < points.length; at++) { const p = points[at], px = p[0], py = p[1]; for (let c = 0; c < centers.length; c++) { const dx = px - centers[c][0], dy = py - centers[c][1]; sum = sum + dx * dy; } } return sum; }
function handed(x: any, y: any, centers: any): any { let sum: any = 0; for (let c = 0; c < centers.length; c++) { const dx = x - centers[c][0], dy = centers[c][1] * y; sum = sum + dx * dy; } return sum; }
function under(points: any, centers: any): any { let sum: any = 0; for (const p of points) { const px = p[0], py = p[1]; for (let c = 0; c < centers.length; c++) sum = sum + (px - centers[c][0]) * (py - centers[c][1]); } return sum; }
function shifted(x: any, centers: any): any { let bits: any = 0; for (let c = 0; c < centers.length; c++) bits = bits ^ ((x | 0) + (x >> 1) + (centers[c][0] & x)); return bits; }
function changed(x: any, centers: any): any { let sum: any = 0; for (let c = 0; c < centers.length; c++) { sum = sum + (x - centers[c][0]); if (c === 1) x = hide("9.5"); } return sum; }
for (let round = 0; round < 3; round++) {
  for (const first of Object.keys(odd)) for (const second of ["fraction", first]) {
    const name = first + " " + second;
    say("pairs " + name, () => pairs(hide([[1.5, 2.5], [odd[first]!(), odd[second]!()], [3.5, 4.5]]), hide(rows())));
    say("handed " + name, () => handed(hide(odd[first]!()), hide(odd[second]!()), hide(rows())));
    say("under " + name, () => under(hide(new Set([[1.5, 2.5], [odd[first]!(), odd[second]!()]])), hide(rows())));
    say("shifted " + name, () => shifted(hide(odd[first]!()), hide(rows())));
    say("changed " + name, () => changed(hide(odd[first]!()), hide(rows())));
  }
  if (round < 2) out.length = 0;
}
let hash = 0; for (const line of out) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(out.length, hash); for (const pick of [0, 7, 23, 51, 52, 60, 77, 101, 133, 160]) console.log(out[pick % out.length]);
console.log(out.filter(line => line.includes(" threw ")).length, out.filter(line => line.includes("valueOf")).length, out.filter(line => line.includes("hint")).length);
export {};
