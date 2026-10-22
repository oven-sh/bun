class A {
  x: number = 1;
  describe(): string { return "A " + this.x; }
}
class B extends A {
  y: number = 2;
  label: string = "bee";
  flag: boolean = true;
  describe(): string { return "B " + this.x + " " + (this.y + 1) + " " + this.label + " " + this.flag; }
}
const made = Reflect.construct(A, [], B) as B;
console.log(made.describe(), made instanceof B, Object.keys(made).join(), made.y, typeof made.label);
console.log(new B().describe(), new A().describe());
