'use strict';
function nested(x, y, m) { let c = 0; for (let j = 0; j < m; j++) for (let i = 0; i < 12; i++) c += (x === 'const' ? 1 : 0) + (y === 'let' ? 10 : 0) + j; return c; }
function both(x) { let c = 0; for (let j = 0; j < 11; j++) for (let i = 0; i < 12; i++) if (x === 'const') c++; return c; }
function early(x, k) { let c = 0; for (let i = 0; i < 12; i++) { if (i === k) return c; if (x === 'const') c++; } return -c; }
function narrowed(x) { let c = 0; for (let i = 0; i < 12; i++) { if (x === 'const') c += x.length; else if (typeof x === 'string') c += x.length * 100; else c--; } return c; }
function handled(x) { let c = 0; try { for (let i = 0; i < 12; i++) { if (x === 'const') c++; if (i === 7) null.x; } } catch { c += 100; } return c; }
function defaulted(x) { let c = 0; for (let i = 0; i < 12; i++) c += (x || 'dev') === 'dev' ? 1 : 2; return c; }
globalThis.kept = [nested, both, early, narrowed, handled, defaulted];
console.log(nested('const', 'let', 0), nested('const', 'var', 2), nested(1, 'let', 3), both('const'), both('x'), early('const', 0), early('const', 5), early('const', 99), narrowed('const'), narrowed('ab'), narrowed(7), handled('const'), handled(0), defaulted(''), defaulted('dev'), defaulted('prod'), defaulted(undefined));
