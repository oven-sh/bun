interface Point { x: number; y: number }
class A {
  note: string = "none";
  kept: Point | undefined;
  constructor() { try { this.init(); } catch (e) { this.note = (e as Error).name; } }
  init(): void {}
}
class B extends A {
  at: Point = { x: 1, y: 2 };
  init(): void { this.kept = this.at; this.note = "x " + this.at.x; }
}
const b = new B();
console.log(b.note, b.kept, b.at.x);
