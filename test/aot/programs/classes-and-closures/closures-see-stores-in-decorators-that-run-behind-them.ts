// Each function makes a closure over `v` and stores to `v` while it evaluates one class with decorators. The decorators of a member run where the member stands, those of the class ahead of everything else. A closure reads what was stored behind its making.
function check(name: string, run: () => unknown) {
  let shown: string;
  try {
    shown = String(run());
  } catch (error) {
    shown = "throws " + error;
  }
  console.log(name + ": " + shown);
}
const dec = (): any => () => {};
check("computed name, then a later member's decorator", () => { let v = 1, g: any; class C { [(g = () => v, "a")]() {} @(v = 2, dec()) b() {} } return g(); });
check("heritage, then a member's decorator", () => { let v = 1, g: any; class C extends (g = () => v, Object) { @(v = 2, dec()) b() {} } return g(); });
check("class decorator, then heritage", () => { let v = 1, g: any; @(g = () => v, dec()) class C extends (v = 2, Object) {} return g(); });
check("heritage, then class decorator", () => { let v = 1, g: any; @(v = 2, dec()) class C extends (g = () => v, Object) {} return g(); });
check("computed name, then class decorator", () => { let v = 1, g: any; @(v = 2, dec()) class C { [(g = () => v, "a")]() {} } return g(); });
check("decorator, then own computed name", () => { let v = 1, g: any; class C { @(g = () => v, dec()) [(v = 2, "a")]() {} } return g(); });
check("own computed name, then decorator", () => { let v = 1, g: any; class C { @(v = 2, dec()) [(g = () => v, "a")]() {} } return g(); });
check("static field, then a member's decorator", () => { let v = 1; class C { static g = () => v; @(v = 2, dec()) b() {} } return C.g(); });
check("static block, then a member's decorator", () => { let v = 1, g: any; class C { static { g = () => v; } @(v = 2, dec()) b() {} } return g(); });
check("static field, then class decorator", () => { let v = 1, g: any; @(v = 2, dec()) class C { static h = (g = () => v); } return g(); });
check("method, then a member's decorator", () => { let v = 1; class C { static m() { return v; } @(v = 2, dec()) b() {} } return C.m(); });
check("method, then class decorator", () => { let v = 1; @(v = 2, dec()) class C { static m() { return v; } } return C.m(); });
check("two decorators of one member", () => { let v = 1, g: any; class C { @(g = () => v, dec()) @(v = 2, dec()) b() {} } return g(); });
check("decorators of two members", () => { let v = 1, g: any; class C { @(g = () => v, dec()) a() {} @(v = 2, dec()) b() {} } return g(); });
check("decorators of two members, other order", () => { let v = 1, g: any; class C { @(v = 2, dec()) a() {} @(g = () => v, dec()) b() {} } return g(); });
check("static member's decorator, then instance member's", () => { let v = 1, g: any; class C { @(g = () => v, dec()) static a() {} @(v = 2, dec()) b() {} } return g(); });
check("instance member's decorator, then static member's", () => { let v = 1, g: any; class C { @(g = () => v, dec()) a() {} @(v = 2, dec()) static b() {} } return g(); });
check("field decorator, then class decorator", () => { let v = 1, g: any; @(v = 2, dec()) class C { @(g = () => v, dec()) a = 1; } return g(); });
check("class decorator, then field decorator", () => { let v = 1, g: any; @(g = () => v, dec()) class C { @(v = 2, dec()) a = 1; } return g(); });
check("constructor, then a member's decorator", () => { let v = 1, g: any; class C { constructor() { g = () => v; } @(v = 2, dec()) b() {} } new C(); return g(); });
check("typed pattern", () => { let v = 1, g: any, x: any; [g, x = v = 2] = [() => v] as any; return g(); });
check("asserted targets", () => { let v = 1, g: any, x: any; [g as any, x! = v = 2] = [() => v]; return g(); });
