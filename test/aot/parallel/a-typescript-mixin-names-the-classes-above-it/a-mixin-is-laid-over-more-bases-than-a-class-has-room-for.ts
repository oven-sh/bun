type Made<T = object> = new (...args: any[]) => T;
class A { a = 1; all(): string { return "a" + this.a; } } class B { b = 2; all(): string { return "b" + this.b; } } class D { d = 3; all(): string { return "d" + this.d; } }
class E { e = 4; all(): string { return "e" + this.e; } } class G { g = 5; all(): string { return "g" + this.g; } } class J { j = 6; all(): string { return "j" + this.j; } }
function topped<T extends Made<{ all(): string }>>(Base: T) { return class Topped extends Base { top = 0; all(): string { this.top++; return super.all() + "+" + this.top; } }; }
const made = [new (topped(A))(), new (topped(B))(), new (topped(D))(), new (topped(E))(), new (topped(G))(), new (topped(J))()];
for (const one of made) console.log(one.all(), one.all(), Object.keys(one).join());
