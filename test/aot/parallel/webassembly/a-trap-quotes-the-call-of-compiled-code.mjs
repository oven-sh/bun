// The message of a trap quotes the call in compiled code that entered WebAssembly, as in plain Bun.
const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,6,1,96,1,127,1,127,3,2,1,0,7,5,1,1,102,0,0,10,9,1,7,0,65,1,32,0,109,11]);
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
const f = e.f; const o = { m: e.f, n: { k: e.f } };
const t = g => { try { g(); } catch (x) { console.log(x.name, "|", x.message); } };
t(() => f(0)); t(() => e.f(0)); t(() => o.m(0)); t(() => o.n.k(0)); t(() => e["f"](0)); t(() => [0].map(e.f)); t(() => new Set([1]).forEach(() => f(0))); t(() => { const r = f(0); return r; }); t(() => 1 + e.f(0));
t(() => f.call(null, 0)); t(() => f.apply(null, [0])); t(() => Reflect.apply(f, null, [0])); t(() => f(...[0]));
