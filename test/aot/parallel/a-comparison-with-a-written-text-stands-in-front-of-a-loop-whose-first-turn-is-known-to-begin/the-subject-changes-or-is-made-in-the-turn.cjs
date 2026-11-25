'use strict';
function changes(x) { let c = 0; for (let i = 0; i < 12; i++) { if (x === 'const') c++; x = i & 1 ? 'const' : 'let'; } return c; }
function made(a, b) { let c = 0; for (let i = 0; i < 12; i++) { const x = i % 3 ? a + b : a; if (x === 'const') c++; } return c; }
function read(o) { let c = 0; for (let i = 0; i < 12; i++) { if (o.kind === 'const') c++; if (i === 5) o.kind = 'const'; } return c; }
function called(o, f) { let c = 0; for (let i = 0; i < 12; i++) { if (o.kind === 'const') c++; f(o, i); } return c; }
globalThis.kept = [changes, made, read, called];
console.log(changes('const'), changes('var'), made('co', 'nst'), made('const', ''), read({ kind: 'let' }), read({ kind: 'const' }), called({ kind: 'let' }, (o, i) => { if (i === 2) o.kind = 'const'; if (i === 8) o.kind = 5; }));
