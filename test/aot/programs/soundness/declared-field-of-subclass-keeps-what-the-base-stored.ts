class A {
  value: unknown;
  constructor() { this.value = this.make(); }
  make(): unknown { return 1; }
}
class B extends A {
  declare value: string;
  make(): unknown { return "made"; }
  size(): number { return this.value.length; }
}
console.log(new B().size(), new B().value, new A().value);
