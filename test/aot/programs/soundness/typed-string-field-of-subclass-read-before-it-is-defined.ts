class A {
  note: string = "none";
  constructor() { try { this.init(); } catch (e) { this.note = (e as Error).name; } }
  init(): void {}
}
class B extends A {
  name: string = "bee";
  init(): void { this.note = "length " + this.name.length; }
}
class C extends A {
  name: string = "sea";
  init(): void { this.note = "name " + this.name; }
}
console.log(new B().note, new C().note, new A().note);
