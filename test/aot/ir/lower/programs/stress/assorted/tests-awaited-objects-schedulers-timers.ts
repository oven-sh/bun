// RUN: lower
// OPTIONS: builtin-modules

// setTimeout and setImmediate of node:timers call their callbacks with the timer as `this`. The program drops both timers.
import timers from "node:timers";

class Body {
  mass = 3;
  tell(): void {
    seen.push(this === undefined ? "none" : String(this.mass));
  }
}

const seen: string[] = [];
const body = new Body();
body.tell();
timers.setTimeout(body.tell, 0);
timers.setImmediate(body.tell);
setTimeout(() => console.log(seen.join(" ")), 30);

// GENERATED: Body tell
// CHECK-LABEL: function {{*}}name="Body"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_3]]} results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = String string="none"
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = PropGet v0 key="mass"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12):
// CHECK-NEXT: v13 = Call v3, v2, v12 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
