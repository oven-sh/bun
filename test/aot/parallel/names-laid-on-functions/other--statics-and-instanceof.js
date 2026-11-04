function Ok(v) { this.v = v; } function Err(e) { this.e = e; }
Ok.of = function (v) { return new Ok(v); }; Err.of = function (e) { return new Err(e); };
function unwrap(r) { if (r instanceof Ok) return r.v; if (r instanceof Err) return -r.e; return 0; }
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += unwrap(i & 3 ? Ok.of(i & 7) : Err.of(1)); return t; }
console.log(run(9)); Object.defineProperty(Ok, Symbol.hasInstance, { value: () => false }); console.log(run(9));
