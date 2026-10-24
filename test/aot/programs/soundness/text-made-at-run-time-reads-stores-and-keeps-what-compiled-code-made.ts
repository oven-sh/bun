// Functions made of text at run time read a field that no compiled code reads, store fractions, texts and objects into a field declared `number`, and keep an array, an object, a closure and a rest array that their makers use nowhere else. eval sees the variables around it.
class P { a = 1; hidden = 2; n: number = 3; }
const p = new P();
console.log(p.a);
const read = new Function("o", "return o.hidden + ':' + Object.keys(o).join()");
console.log(read(p));
const write = new Function("o", "v", "o.n = v; return o");
p.n = 4; console.log(p.n + 1);
write(p, 1.5); console.log(p.n, p.n * 2);
write(p, "text"); console.log(p.n, typeof p.n);
write(p, { obj: 1 }); console.log(p.n);
let kept: any;
const keep = new Function("x", "globalThis.__kept = x; return 1");
function frame(a: number, b: number) { const t = [a, b, a + b]; const o = { a, b }; const c = () => a + b; return keep(t) + keep2(o) + keep3(c); }
const keep2 = new Function("x", "globalThis.__kept2 = x; return 1");
const keep3 = new Function("x", "globalThis.__kept3 = x; return 1");
console.log(frame(1, 2));
function churn(a: number, b: number, c: number, d: number) { const t = [a, b, c, d]; const o = { x: a, y: b }; return t[0] + t[3] + o.x + o.y; }
let s = 0; for (let i = 0; i < 1000; i++) s += churn(i, i, i, i); console.log(s);
const g: any = globalThis; console.log(JSON.stringify(g.__kept), JSON.stringify(g.__kept2), g.__kept3());
function rest(...args: number[]) { return keep(args); } rest(7, 8, 9); for (let i = 0; i < 1000; i++) s += churn(i, 1, 2, 3); console.log(JSON.stringify(g.__kept));
function evalSees() { let local = 5; const inc = () => ++local; inc(); return eval("local + 1") + (0, eval)("typeof local"); } console.log(evalSees());
function unusedParam(a: number, b: number) { return a; } console.log(new Function("f", "return f(1, 2) + f.length")(unusedParam));
function usesArguments() { return new Function("a", "return a.length + ':' + a[1]")(arguments); } console.log((usesArguments as any)(1, 2, 3));
const frozenLit = { k: 1, unreadByCode: "seen" }; console.log(frozenLit.k, new Function("o", "let r=''; for (const k in o) r += k + o[k]; return r")(frozenLit));
