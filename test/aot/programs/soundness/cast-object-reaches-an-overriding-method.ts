class A {
  take(v: string): number { return v.length; }
  run(x: unknown): number { return this.take(x as string); }
}
class B extends A {
  take(v: string): number { return typeof v === "string" ? v.length : -1; }
}
console.log(new B().run({}), new B().run("abc"), new A().run("ab"));
