class A {
  value: number | string = 1;
  seen: number | string;
  constructor() { this.seen = this.value; }
  double(): number | string { return typeof this.value === "number" ? this.value * 2 : this.value + this.value; }
}
class B extends A { value: string = "text"; }
class C extends A { value: number = 2.5; }
for (const o of [new A(), new B(), new C()]) console.log(o.seen, o.value, o.double(), Object.keys(o).join());
