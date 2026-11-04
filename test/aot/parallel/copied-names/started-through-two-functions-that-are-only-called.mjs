function outer(run) { let x = 1; const early = run(a); x = 2; return early(); function a() { return b(); } function b() { return c(); } function c() { return () => x; } }
console.log(outer(f => f()));
