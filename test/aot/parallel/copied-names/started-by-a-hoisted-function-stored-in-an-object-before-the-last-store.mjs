function outer(box) { let x = 1; box.a = a; const early = box.a(); x = 2; return early(); function a() { return walk(); } function walk() { return () => x; } }
console.log(outer({}));
