function outer(run) { let out; { let x = 1; const early = run(a); x = 2; out = early(); function a() { return walk(); } function walk() { return () => x; } } return out; }
console.log(outer(f => f()));
