function take(s: string) { return s.length; }
function takeNumber(n: number) { return n + 1; }
class P { x: number; constructor(x: number) { this.x = x; } }
function takeObject(p: P) { return p.x; }
function pick(x: string, y: string, k: number) { const t = [x, y]; return take(t[k & 1]); }
function pickNumber(x: number, y: number, k: number) { const t = [x, "no", y, "yes"]; const e = t[(k & 1) * 2]; return takeNumber(e as number); }
function pickObject(x: P, y: P, k: number) { const t = [x, y]; return takeObject(t[k & 1]); }
function store(x: string, y: string, k: number, into: { s: string }) { const t = [x, y]; into.s = t[k & 1]; return into.s.length; }
const lie: any = JSON.parse("7");
const text: any = JSON.parse('"abc"');
const bare: any = JSON.parse('{"x":"own"}');
function show(make: () => unknown) { try { console.log(String(make())); } catch (error) { console.log((error as Error).constructor.name); } }
for (let k = 0; k < 4; k++) {
  show(() => pick(lie, "ab", k));
  show(() => pick("ab", lie, k));
  show(() => pickNumber(text, 2, k));
  show(() => pickNumber(1, text, k));
  show(() => pickObject(bare, new P(2), k));
  show(() => pickObject(new P(1), lie, k));
  show(() => store(lie, "ab", k, { s: "" }));
}
