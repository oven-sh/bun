// `k.m.bind(k)` creates a small closure inline, and calling it is as fast as calling an arrow function.
// IR+ TypeTest v[0-9]+ testedType=Function\^
// IR+ NewClosure \(.*\) function=f[0-9]+
// IR+ ^function f[0-9]+ "add" \w+ role=BoundFunction
// IR= 0 constructs NewClosure
declare const console: any;
class K { constructor(public v: number) {} add(x: number): number { return this.v + x; } addTwo(a: number, x: number): number { return this.v + a + x; } }
function free(this: K, x: number): number { return this.v * x; }
function makes(k: K): (x: number) => number { return k.add.bind(k); }
function makesWithArgument(k: K, a: number): (x: number) => number { return k.addTwo.bind(k, a); }
// It constructs: JavaScriptCore's bound function.
function constructs(k: K): (x: number) => number { return free.bind(k); }
function calls(f: (x: number) => number, x: number): number { return f(x); }
const ks: K[] = []; for (let i = 0; i < 8; i++) ks.push(new K(i));
let s = 0;
for (let i = 0; i < 3_000_000; i++) { const k = ks[i & 7]; s = (s + calls(makes(k), i) + calls(makesWithArgument(k, 1), i)) | 0; }
const kept = ks.map(makes);
for (let i = 0; i < 6_000_000; i++) s = (s + calls(kept[i & 7], i)) | 0;
console.log(s, constructs(ks[2])(3));
export {};
