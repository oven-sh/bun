// pop() and shift() of lists of every storage, typed and not, while the lists grow, shrink, hold holes and change their storage.
let cases = 0, digest = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const show = (v: unknown): string => v === null || typeof v !== "object" ? typeof v + String(v) + (v === 0 ? 1 / (v as number) : "") : "{" + Object.keys(v as object).join() + "}";
const makers: (() => any)[] = [() => [1, 2, 3], () => [0.5, -0, NaN], () => ["a", "b"], () => [{ x: 1 }, { y: 2 }], () => [1, "a", 0.5, null, undefined], () => [1, , 3], () => [0.5, , 1.5], () => [], () => new Array(4), () => [true, 2147483647, -2147483648, 4294967295], () => Array.from({ length: 70 }, (_, i) => i), () => Array.from({ length: 70 }, (_, i) => i + 0.5), () => Array.from({ length: 70 }, (_, i) => "t" + i), () => { const a: any[] = [1]; a[5000] = 2; return a; }, () => Object.assign([1, 2], { kind: "k" }), () => [1, 2, 3, 4].slice(1), () => [[1], [2]], () => { const a: any[] = [1, 2, 3]; a.length = 2; return a; }];
function popOf(a: any): any { return a.pop(); }
function shiftOf(a: any): any { return a.shift(); }
function drainEnd(a: any): string { let t = ""; for (let i = 0; i < 80; i++) { const v = a.pop(); t += show(v); if (a.length === 0 && i > 4) break; } return t + a.length; }
function drainStart(a: any): string { let t = ""; for (let i = 0; i < 80; i++) { const v = a.shift(); t += show(v); if (a.length === 0 && i > 4) break; } return t + a.length; }
function ignored(a: any): string { for (let i = 0; i < 3; i++) { a.pop(); a.shift(); } return a.length + show(a[0]); }
function mixed(a: any): string { let t = ""; for (let i = 0; i < 12; i++) { a.push(i % 5 === 0 ? i + 0.5 : i % 3 === 0 ? "s" + i : i); t += show(i & 1 ? a.shift() : a.pop()) + show(a.at(-1)); } return t + a.join(); }
function typedNumbers(a: number[]): string { let t = ""; for (let i = 0; i < 6; i++) { a.push(i); a.push(i + 0.25); t += a.pop()! + "," + a.shift()! + ";"; } return t + a.length; }
function typedTexts(a: string[]): string { let t = ""; for (let i = 0; i < 6; i++) { a.push("p" + i, "q"); t += a.pop()! + a.shift()!; } return t + a.length; }
function typedObjects(a: { x: number }[]): number { let n = 0; for (let i = 0; i < 6; i++) { a.push({ x: i }, { x: i * 2 }); n += a.pop()!.x + (a.shift()?.x ?? 100); } return n; }
for (let round = 0; round < 4; round++) {
  makers.forEach((make, k) => { const line = [popOf, shiftOf].map(f => show(f(make()))).join() + drainEnd(make()) + drainStart(make()) + ignored(make()) + mixed(make()); add(line); if (round === 3) console.log(k, line.length, digest); });
  add(typedNumbers([1, 2]) + typedNumbers([0.5]) + typedNumbers([]) + typedTexts(["a"]) + typedTexts([]) + typedObjects([{ x: 9 }]) + typedObjects([]));
}
const queue: any[] = []; let out = "";
for (let i = 0; i < 2000; i++) { queue.push(i & 3 ? i : i & 4 ? "t" + i : { i }); if (i % 3 !== 0) out += show(queue.shift()).length; if (i % 7 === 0) out += show(queue.pop()).length; }
add(out); console.log(queue.length, out.length, cases, digest);
