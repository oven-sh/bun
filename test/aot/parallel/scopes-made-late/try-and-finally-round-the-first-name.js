function f(quick) { if (quick) return "quick"; try { let n = 0; const bump = () => ++n; bump(); return "n" + bump(); } finally { quick = true; } }
function g(fail) { let out = []; try { if (fail) throw new Error("x"); let n = 0; out.push(() => ++n); } catch (e) { let m = 10; out.push(() => ++m); } return out.map(h => h() + h()).join(); }
console.log(f(true), f(false), g(true), g(false));
