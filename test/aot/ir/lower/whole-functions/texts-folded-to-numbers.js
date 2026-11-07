// RUN: lower

export function fold() {
  return [+"12", "0x10" * 1, -" 7 ", +"1e3", +"x"];
}

// GENERATED: fold
// CHECK-LABEL: function {{*}}name="fold"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
