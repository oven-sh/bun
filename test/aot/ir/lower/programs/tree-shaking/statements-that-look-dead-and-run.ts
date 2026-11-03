// RUN: lower
// OPTIONS: builtin-modules

// Code that stands in or beside something a compiler removes, and still runs: the body of do-while(false), the initializer of for(;false;), the else of if(false), a case that is fallen into, catch and finally, the operand of void, a comma, a label that is left.
const log: string[] = [];
function inDo() { log.push("do"); } function inForInit() { log.push("for init"); } function inElse() { log.push("else"); }
function inFallThrough() { log.push("fall through"); } function inDefault() { log.push("default"); } function inCatch() { log.push("catch"); }
function inFinally() { log.push("finally"); } function underVoid() { log.push("void"); } function beforeComma() { log.push("comma"); }
function beforeBreak() { log.push("before break"); } function afterLabel() { log.push("after label"); } function inCondition() { log.push("condition"); return false; }
function inFinallyAfterReturn() { log.push("finally after return"); } function inUnusedTemplate() { log.push("template"); return ""; }
function asUnusedArgument() { log.push("argument"); } function inUnusedArray() { log.push("array"); } function inUnusedObject() { log.push("object"); return "k"; }

do inDo(); while (false);
for (inForInit(); false; );
if (false) {
} else inElse();
switch (1 as number) {
  case 1:
  case 2:
    inFallThrough();
  default:
    inDefault();
}
try {
  throw 1;
} catch {
  inCatch();
} finally {
  inFinally();
}
void underVoid();
beforeComma(), 0;
label: {
  beforeBreak();
  break label;
}
afterLabel();
if (inCondition()) {
}
(() => {
  try {
    return;
  } finally {
    inFinallyAfterReturn();
  }
})();
`${inUnusedTemplate()}`;
((...ignored: unknown[]) => {})(asUnusedArgument());
[inUnusedArray()];
({ [inUnusedObject()]: 1 });
console.log(log.join(", "));

// GENERATED: inFinallyAfterReturn inCondition inUnusedTemplate
// CHECK-LABEL: function {{*}}name="inFinallyAfterReturn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="finally after return"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_2]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inCondition"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=boolean site=[[w_3]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="condition"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_4]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Boolean
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean site=[[w_3]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inUnusedTemplate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="template"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = String string=""
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
