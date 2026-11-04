function outer(run) { let x = 1; const get = () => a; const early = run(get()); x = 2; return early(); function a() { return walk(); } function walk() { return () => x; } }
console.log(outer(f => f()));
