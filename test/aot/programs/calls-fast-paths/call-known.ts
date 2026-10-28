// `Base.call(this, x)` with a known callee becomes a direct call, which is inlined.
// IR+ TypeTest v[0-9]+ testedType=Function\^
// IR- CallMethod v[0-9]+ \(.*\) name="call"(?!.* isFallback)
declare const console: any;
function Base(this: any, v: number) { this.v = v; }
function Derived(this: any, v: number) { Base.call(this, v + 1); }
let n = 0;
const o: any = { v: 0 };
for (let i = 0; i < 5_000_000; i++) { Derived.call(o, i & 3); n += o.v; }
console.log(n);
export {};
