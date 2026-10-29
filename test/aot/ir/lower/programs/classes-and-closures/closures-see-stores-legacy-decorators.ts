// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// Each function makes a closure over `v` and stores to `v` while it evaluates one class with decorators of `experimentalDecorators`, which run when the class and its static members are done. A closure reads what was stored behind its making.
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
check("parameter decorator, then member decorator", () => { let v = 1, g: any; class C { @(v = 2, dec()) a(@(g = () => v, dec()) p: any) {} } return g(); });
check("member decorator, then parameter decorator", () => { let v = 1, g: any; class C { @(g = () => v, dec()) a(@(v = 2, dec()) p: any) {} } return g(); });
check("constructor parameter decorator, then class decorator", () => { let v = 1, g: any; @(v = 2, dec()) class C { constructor(@(g = () => v, dec()) p: any) {} } return g(); });
check("class decorator, then constructor parameter decorator", () => { let v = 1, g: any; @(g = () => v, dec()) class C { constructor(@(v = 2, dec()) p: any) {} } return g(); });

// FILE: tsconfig.json
{ "compilerOptions": { "experimentalDecorators": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "types": [] } }

// GENERATED: check dec m
// CHECK-LABEL: function {{*}}name="check"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="throws "
// CHECK-NEXT: v10 = Add v9, v8
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12: undefined|null|string):
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string=": "
// CHECK-NEXT: v19 = Add v0, v18
// CHECK-NEXT: v20 = Add v19, v12
// CHECK-NEXT: v21 = Call v17, v15, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dec"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_7]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: env [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="v"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: env [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="v"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
