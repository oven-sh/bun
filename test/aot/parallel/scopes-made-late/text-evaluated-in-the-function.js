function f(quick, text) { if (quick) return eval(text); let n = 1; const bump = () => ++n; bump(); return eval(text); }
let said; try { said = f(true, "n"); } catch (e) { said = e.constructor.name; }
console.log(said, f(false, "n"), f(false, "bump()"));
