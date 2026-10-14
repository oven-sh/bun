// `constructor() { this.add = this.add.bind(this) }`: a later `k.add(x)` finds the bound own property and calls the method.
// IR+ IsClosureOf v[0-9]+ f[0-9]+ as made
// IR+ function [0-9]+ "bound add" Bound
// IR+ frame [0-9]+ = IsClosureOf v[0-9]+ f[0-9]+$
// IR+ frame [0-9]+ = GetCapture v[0-9]+
declare const console: any;
class K { v: number; constructor(v: number) { this.v = v; this.add = this.add.bind(this); } add(x: number): number { return this.v + x; } }
function calls(k: K, x: number): number { return k.add(x); }
function passes(k: K): (x: number) => number { return k.add; }
function through(f: (x: number) => number, x: number): number { return f(x); }
const ks: K[] = []; for (let i = 0; i < 8; i++) ks.push(new K(i));
let s = 0;
for (let i = 0; i < 12_000_000; i++) s = (s + calls(ks[i & 7], i)) | 0;
for (let i = 0; i < 4_000_000; i++) s = (s + through(passes(ks[i & 7]), i)) | 0;
for (let i = 0; i < 1_000_000; i++) s = (s + new K(i).add(1)) | 0;
console.log(s);
export {};
