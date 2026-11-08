function Early() {}
function Late() {}
globalThis.Crate = Early;
function swap(made) { globalThis.Crate = globalThis.Crate === Early ? Late : Early; return made; }
function test(made) { const Kind = Crate; const value = swap(made); return value instanceof Kind; }
globalThis.kept = test;
console.log(globalThis.kept(new Early()), globalThis.kept(new Early()), globalThis.kept(new Late()), globalThis.kept(new Late()));
