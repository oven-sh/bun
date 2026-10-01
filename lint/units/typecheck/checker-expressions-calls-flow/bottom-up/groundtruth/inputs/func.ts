const f1 = (x: string | number) => typeof x === "string";
declare const v: string | number;
if (f1(v)) { const a: number = v; }
function f2(x) { return x; }
const f3 = function () { return null; };
const f4 = () => { if (Math.random()) return 1; return "a"; };
const r4: boolean = f4();
async function f5() { return 1; }
const r5: number = f5();
function* f6() { const x = yield 1; yield "a"; return true; }
const r6: number = f6();
const f7 = () => { throw 1; };
const r7: string = f7();
function f8(): number { }
const f9 = (): string => 1;
const f10 = () => f10();
function f11() { return f11; }
const f12 = (a = b12, b12 = 1) => a;
class Q { m = () => this.n; n = 1; static s = class { x = 1 }; }
const f13: (cb: (x: number) => void) => void = cb => cb("s");
