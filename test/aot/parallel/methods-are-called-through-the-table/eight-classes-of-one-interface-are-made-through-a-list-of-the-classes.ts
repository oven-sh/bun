// STATISTIC: MethodCallsThroughTable >= 1
// Eight classes say that they implement one interface and have no class in common. They are made through a list of the classes, so what is made is known only as what the constructors of that interface's classes make.
interface Shape { area(): number }
class A implements Shape { constructor(public n: number) {} area(): number { return this.n * 1; } }
class B implements Shape { constructor(public n: number) {} area(): number { return this.n * 2; } }
class C implements Shape { constructor(public n: number) {} area(): number { return this.n * 3; } }
class D implements Shape { constructor(public n: number) {} area(): number { return this.n * 4; } }
class E implements Shape { constructor(public n: number) {} area(): number { return this.n * 5; } }
class F implements Shape { constructor(public n: number) {} area(): number { return this.n * 6; } }
class G implements Shape { constructor(public n: number) {} area(): number { return this.n * 7; } }
class H implements Shape { constructor(public n: number) {} area(): number { return this.n * 8; } }
const makers = [A, B, C, D, E, F, G, H];
const shapes: Shape[] = [];
for (let i = 0; i < 8; i++) shapes.push(new makers[i % 8]!(1));
let sum = 0;
for (let turn = 0; turn < 1000; turn++) for (const shape of shapes) sum += shape.area();
console.log(sum);
