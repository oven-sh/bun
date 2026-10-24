class A {
  log: string[] = [];
  constructor(public x: number, protected name: string) { this.report(); }
  report(): void { this.log.push("A " + this.x + " " + this.name); }
}
class B extends A {
  extra: number = 10;
  constructor(x: number, public factor: number) { super(x * 2, "bee"); this.report(); }
  report(): void { this.log.push("B " + this.x + " " + this.name + " " + this.extra + " " + this.factor + " " + (this.extra * this.factor)); }
}
console.log(new B(1, 3).log.join(" | "));
console.log(new A(1, "a").log.join(" | "));
