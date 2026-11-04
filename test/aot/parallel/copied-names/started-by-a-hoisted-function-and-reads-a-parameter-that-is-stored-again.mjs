function outer(run, p) { const early = run(a); p = 2; return early(); function a() { return walk(); } function walk() { return () => p; } }
console.log(outer(f => f(), 1));
