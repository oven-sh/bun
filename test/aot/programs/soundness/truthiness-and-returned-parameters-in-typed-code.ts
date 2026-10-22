class S { f = 1; }
function viaTruthiness(s: S) { return s.f; }
function viaTest(s: S) { return s.f; }
function throughTruthiness(s: S | undefined) { return s ? viaTruthiness(s) : 0; }
function throughTest(s: S | undefined) { return s !== undefined ? viaTest(s) : 0; }
console.log(throughTruthiness(new S()), throughTruthiness(undefined), throughTest(new S()), throughTest(undefined));
console.log(throughTruthiness(0 as any), throughTruthiness("" as any), throughTruthiness({ f: 5 } as any), throughTruthiness("text" as any));

class N { n = 1; }
class M { m = 2; }
let seen = 0;
function keepShared(a: N | M) { if (a instanceof N) seen++; return a; }
function keepOnce(a: N | M) { return a; }
console.log((keepShared(new N()) as N).n + (keepShared(new M()) as M).m, (keepOnce(new N()) as N).n + (keepOnce(new M()) as M).m, seen);
console.log(keepShared("neither" as any), keepOnce(7 as any), (keepShared(new M()) as N).n);
