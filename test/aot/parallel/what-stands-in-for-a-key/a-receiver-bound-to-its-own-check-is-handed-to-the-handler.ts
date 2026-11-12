class A { m() { return 1; } } class B { m() { return 2; } }
function f(o: A | B | undefined, n: number): any { try { for (let i = 0; i < n; i++) o!.m(); if (n > 2) throw 1; return 0; } catch { return o; } }
console.log(f(new A(), 1), f(new B(), 1), f(undefined, 1) === undefined, f(new A(), 3) instanceof A);
export {};
