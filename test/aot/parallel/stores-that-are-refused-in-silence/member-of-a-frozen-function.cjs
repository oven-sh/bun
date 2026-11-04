function f() {}
f.x = 1;
Object.freeze(f);
f.x = 2; f.y = 3;
console.log(f.x, f.y);
