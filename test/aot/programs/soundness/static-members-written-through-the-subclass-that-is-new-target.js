class A {
  static count = 0;
  static names = [];
  constructor() {
    new.target.count += 1;
    new.target.names.push(new.target.name);
    this.constructor.total = (this.constructor.total ?? 0) + 1;
    this.n = new.target.count;
  }
}
class B extends A {}
const list = [new A(), new B(), new B(), new A()];
console.log(list.map(o => o.n).join());
console.log(A.count, B.count, Object.hasOwn(B, "count"), Object.hasOwn(B, "names"), A.names.join());
console.log(A.total, B.total, Object.hasOwn(B, "total"));
