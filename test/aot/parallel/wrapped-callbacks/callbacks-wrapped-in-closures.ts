// A callback that another closure captures and calls: what it captured is known where both are done in place. Variables that change, errors, callbacks that stay and callbacks of callers that nobody knows.
function everyInRange(start: number, end: number, pred: (n: number) => boolean): boolean {
  for (let i = start; i < end; i++) {
    if (!pred(i)) return false;
  }
  return true;
}
function every(s: string, pred: (ch: number, index: number) => boolean, start = 0, end = s.length): boolean {
  return everyInRange(start, end, i => pred(s.charCodeAt(i), i));
}
function lower(ch: number): number { return ch >= 65 && ch <= 90 ? ch + 32 : ch; }
function indexOfIgnoringCase(str: string, value: string): number {
  const n = str.length - value.length;
  for (let start = 0; start <= n; start++) {
    if (every(value, (valueChar, i) => lower(str.charCodeAt(i + start)) === valueChar)) return start;
  }
  return -1;
}
function sumOf(list: readonly number[], of: (n: number) => number): number { let sum = 0; for (const n of list) sum += of(n); return sum; }
function sumOfSquares(list: readonly number[], of: (n: number) => number): number { return sumOf(list, n => of(n) * of(n)); }
function scaled(list: readonly number[], by: number, plus: string | undefined): number { let calls = 0; const sum = sumOfSquares(list, n => { calls++; return n * by + (plus ? plus.length : 0); }); return sum * 100 + calls; }
let kept: ((n: number) => boolean)[] = [];
function keep(s: string, n: number): boolean { let seen = 0; const answer = everyInRange(0, n, i => { seen += i; kept.push(k => k + seen > s.length); return seen < 40; }); seen += 100; return answer; }
function throwing(list: readonly number[], at: number): string { let done = ""; try { sumOfSquares(list, n => { if (n === at) throw new Error("at " + at + done); done += n; return n; }); return "no " + done; } catch (e: any) { return e.message; } }
function nested(a: string, b: number, c: boolean): string { const wrap = (f: (x: string) => string) => (g: (y: string) => string) => (z: string) => f(g(z + b)); return wrap(x => x + a + c)(y => y + (c ? b : a))("z"); }
Object.assign(globalThis, { everyInRange, every, indexOfIgnoringCase, sumOf, sumOfSquares, scaled, keep, throwing, nested });
const g: any = globalThis; let log = "";
const names = ["getTypeOfSymbol", "resolveName", "checkNODE", "", "a", "isDeclaration", "FLOWNode", "x".repeat(40) + "Node", "état", "中Node"];
for (const n of names) for (const p of ["node", "type", "", "q", "symbol", "é"]) log += g.indexOfIgnoringCase(n, p) + " ";
for (const n of names) log += indexOfIgnoringCase(n + "Tail", "tail") + " ";
log += g.scaled([1, 2.5, -3, 4], 2, "ab") + " " + g.scaled([1, 2], 1, undefined) + " " + g.scaled([], 3, "x") + " ";
log += g.keep("abc", 6) + " " + g.keep("abcdefgh", 20) + " " + kept.map(k => k(3)).join("") + " ";
log += g.throwing([1, 2, 3], 2) + " " + g.throwing([4, 5], 9) + " " + g.nested("a", 4, true) + " " + g.nested("bb", 0, false) + " ";
log += g.every("abc", (ch: number, i: number) => ch === 97 + i) + " " + g.every("abd", (ch: number, i: number) => ch === 97 + i) + " " + g.every("xabc", (ch: number, i: number) => ch === 96 + i, 1, 4) + " ";
for (const odd of [undefined, null, 5, { length: 2 }, ["a", "b"], Object("Node")] as any[]) { try { log += g.indexOfIgnoringCase(odd, "o") + " "; } catch (e: any) { log += e.name + " "; } try { log += g.indexOfIgnoringCase("Node", odd) + " "; } catch (e: any) { log += e.name + " "; } }
try { g.everyInRange(0, 3, undefined); } catch (e: any) { log += e.name; }
console.log(log);
