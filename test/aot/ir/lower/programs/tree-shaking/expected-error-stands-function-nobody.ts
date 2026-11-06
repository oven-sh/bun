// RUN: lower
// OPTIONS: builtin-modules

// `// @ts-expect-error` is itself an error where the next line has none. Here each stands above a real type error, inside a function, an arrow function, a method and a constructor that nobody calls. A build that does not look into those bodies must not call the comments unused.
function unusedFunction(): number {
  // @ts-expect-error
  const wrong: number = "text";
  return wrong;
}
const unusedArrow = (): string => {
  // @ts-expect-error
  return 5;
};
class Unused {
  field: number;
  constructor() {
    // @ts-expect-error
    this.field = "text";
  }
  method(): boolean {
    // @ts-expect-error
    return this.field.noSuchMember;
  }
}
export function unusedExport(): void {
  // @ts-expect-error
  unusedFunction("too", "many");
}

console.log("built and ran");

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="built and ran"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unusedExport"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = String string="too"
// CHECK-NEXT: v2 = String string="many"
// CHECK-NEXT: v3 = Call v0, -, v1, v2 calleeName="unusedFunction"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_2]]}
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unusedFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="text"
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_4]]} illTypedCause=SuppressedError
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
