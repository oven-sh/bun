declare const o: { alpha: number; beta?: { c: string } }, u: { a: 1 } | undefined, nl: null, un: unknown;
const p1 = o.alhpa;
const p2 = o.gamma;
const p3 = o.beta.c;
const p4 = u.a;
const p5 = nl.x;
const p6 = un.x;
const p7 = o["alpha"].x;
const p8 = o[0];
const p9 = undefinedName;
class C { private priv = 1; protected prot = 2; readonly ro = 3; static st = 4; #hash = 5; m() { return this.priv + this.#hash; } }
class D extends C { constructor() { this.x; super(); } x = super.prot; static s = this.st; m2() { return super.m(); } }
declare const c: C;
c.priv; c.prot; c.ro = 4; c.st; C.st; c.#hash;
function ff() { return this.q; }
const q1 = arguments;
let late: string; late.length;
enum E { A } E.A = 1; E.B;
namespace N { export const v = 1; } N.w; N = 1;
const q2 = o?.beta?.c.length.toFixed();
const q3: string = o.beta!.c.missing;
import.meta.x;
new.target;
