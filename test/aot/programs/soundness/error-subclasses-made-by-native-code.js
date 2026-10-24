class A extends Error {
  constructor(message, options) { super(message, options); this.name = this.label(); this.code = new.target.code; }
  label() { return "A"; }
  static code = 1;
}
class B extends A {
  extra = "x";
  label() { return "B" + this.extra; }
  static code = 2;
}
function show(o) { console.log(o.name, o.message, o.code, o.extra, o instanceof B, String(o), Object.keys(o).join(), o.cause); }
show(new B("boom", { cause: 7 }));
show(Reflect.construct(A, ["made"], B));
show(Reflect.construct(Error, ["plain"], B));
show(new A("base"));
try { throw new B("thrown"); } catch (e) { show(e); }
Promise.reject(new B("rejected")).catch(show);
