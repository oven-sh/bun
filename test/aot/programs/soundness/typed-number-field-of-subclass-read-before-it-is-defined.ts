class A {
  seen: number = 0;
  sum: number = 0;
  constructor() { this.init(); }
  init(): void {}
}
class B extends A {
  y: number = 2;
  z: number = 2.5;
  init(): void { this.seen = this.y; this.sum = this.y + this.z; }
}
const b = new B();
console.log(b.seen, b.sum, b.y, b.z, typeof b.seen, Object.keys(b).join());
const a = new A();
console.log(a.seen, a.sum);
