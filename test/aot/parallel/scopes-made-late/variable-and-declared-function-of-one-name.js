function declared(quick) { if (quick) return "quick"; var f; function f() { return 1; } return [f, () => f].map(g => typeof g()).join(); }
function initialized(quick) { if (quick) return "quick"; var f = 1; function f() {} return (() => f)(); }
function stored(quick) { if (quick) return typeof f; const read = () => f; f = 2; function f() {} return read(); }
console.log(declared(true), declared(false), initialized(true), initialized(false), stored(true), stored(false));
