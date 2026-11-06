// A field declared without a value in a class that is constructed for another class.
class A {
  a;
  constructor(a) {
    this.a = a;
  }
}
class Other {
  a = "text";
  len() {
    return this.a.length;
  }
}
for (let i = 0; i < 12; i++) {
  const o = Reflect.construct(A, [i], Other);
  if (i > 10) console.log(o.a, o instanceof Other, o instanceof A, Object.keys(o).join());
}
console.log(new Other().len(), new A(2).a);
