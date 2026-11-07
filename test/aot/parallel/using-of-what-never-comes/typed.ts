function boom(): Disposable { throw new RangeError("r"); }
function f(): number { using r0 = boom(); return 0; }
try { console.log(f()); } catch (e) { console.log((e as Error).name); }
