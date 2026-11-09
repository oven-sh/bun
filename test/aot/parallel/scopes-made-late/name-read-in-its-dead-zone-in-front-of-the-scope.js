function f(early) { let said = "none"; if (early) { try { said = String(late); } catch (e) { said = e.constructor.name; } } let late = 1; const bump = () => ++late; return said + bump(); }
console.log(f(true), f(false));
