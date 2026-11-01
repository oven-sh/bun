const tried = (name, run) => { try { console.log(name, run()); } catch (e) { console.log(name, e.name); } };
class A {}
class AheadOfSuper extends A {
  constructor() {
    tried("computed", () => delete super[console.log("the key runs")]);
    tried("named", () => delete super.x);
    tried("the key throws", () => delete super[(() => { throw new RangeError(); })()]);
    tried("the key calls super()", () => delete super[super()]);
  }
}
new AheadOfSuper();
class BehindSuper extends A {
  constructor() {
    super();
    tried("computed", () => delete super[console.log("the key runs")]);
    tried("named", () => delete super.x);
  }
  method() { tried("in a method", () => delete super[console.log("the key runs")]); }
  static method() { tried("in a static method", () => delete super[console.log("the key runs")]); }
}
new BehindSuper().method();
BehindSuper.method();
tried("in an object", () => ({ method() { return delete super[console.log("the key runs")]; } }).method());
class InTheBody extends A {
  constructor() {
    try { delete super[console.log("the key runs")]; } catch (e) { console.log("in the body", e.name); }
    super();
  }
}
new InTheBody();
