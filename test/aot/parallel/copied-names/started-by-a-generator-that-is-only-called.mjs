function outer() { let x = 1; const it = a(); const early = it.next().value; x = 2; return early(); function* a() { yield walk(); } function walk() { return () => x; } }
console.log(outer());
