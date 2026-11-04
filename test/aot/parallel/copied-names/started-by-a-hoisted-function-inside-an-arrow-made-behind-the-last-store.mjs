function outer(run) { let x = 1; x = 2; const late = () => { return run(a); function a() { return walk(); } }; return late()(); function walk() { return () => x; } }
console.log(outer(f => f()));
