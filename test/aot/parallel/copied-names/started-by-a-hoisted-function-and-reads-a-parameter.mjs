function outer(run, p) { const early = run(a); return early(); function a() { return walk(); } function walk() { return () => p; } }
console.log(outer(f => f(), 7));
