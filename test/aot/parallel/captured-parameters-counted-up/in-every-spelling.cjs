function later(list, at) { at++; return () => list[at++]; }
function scale(by) { by *= 0.5; return x => x * by; }
function from(i, step = 1) { const get = () => i; while (i < 10) i += step; return get; }
function walk(i, seen) { if (i > 3) return () => i; seen.push(() => i); i = i + 1; return walk(i, seen); }
function pick(i) { try { i++; return () => i; } finally { i = i * 2; } }
function handed(i, f) { f(() => i); i = i + 1; f(() => i); return i; }
function parse(text, pos) { const peek = () => text[pos], eat = () => text[pos++]; let n = 0; while (peek() >= "0" && peek() <= "9") n = n * 10 + +eat(); return [n, pos]; }
function* counted(i) { while (i < 5) { yield () => i; i++; } }
const next = later([1, 2, 3, 4], 0), seen = [], got = [];
console.log(next(), next(), next(), [scale(3)(2), scale(5)(1), scale(-0)(1) === 0].join());
console.log(from(0)(), from(0, 3)(), from(9.5)(), walk(0, seen)(), seen.map(f => f()).join(), pick(1)(), pick(2.5)());
handed(1, g => got.push(g)); handed(null, g => got.push(g));
console.log(got.map(g => String(g())).join(), parse("x123y", 1).join(), [...counted(3)].map(f => f()).join());
