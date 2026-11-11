function outer(run, yes) { let x = 1; let early = () => 0; if (yes) early = run(a); x = 2; return early(); function a() { return walk(); } function walk() { return () => x; } }
console.log(outer(f => f(), true), outer(f => f(), false));
