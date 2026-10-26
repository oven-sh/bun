// RUN: lower
// CHECK-LABEL: function {{*}}name="ofACall"
// CHECK: = InstanceOf
// CHECK-NOT: writtenExpression
// CHECK-LABEL: function {{*}}name="ofAVariableUsedOnce"
// CHECK: = InstanceOf
// CHECK-NOT: writtenExpression
// CHECK-LABEL: function {{*}}name="ofAVariableUsedTwice"
// CHECK: = InstanceOf {{*}} writtenExpression="left instanceof local"
// CHECK-LABEL: function {{*}}name="ofLiterals"
// CHECK: = InstanceOf {{*}} writtenExpression="null instanceof right"
// CHECK: = InstanceOf {{*}} writtenExpression="void 0 instanceof right"
// CHECK: = InstanceOf {{*}} writtenExpression="!0 instanceof right"
// CHECK-LABEL: function {{*}}name="ofNames"
// CHECK: = InstanceOf {{*}} writtenExpression="left instanceof right"
// CHECK-LABEL: function {{*}}name="ofPaths"
// CHECK: = InstanceOf {{*}} writtenExpression="this.value instanceof holder.inner[key].list[0]"
// CHECK-LABEL: function {{*}}name="withoutTypes"
// CHECK: = InstanceOf {{*}} writtenExpression="left instanceof right"

// `instanceof` holds its text, as Bun's transpiler prints it, where both operands consist of names or are one of a few literals: a message quotes it.
// The transpiler may print the initializer of a local variable in place of its only use: no text then.
export function ofNames(left: any, right: any) {
  return left instanceof right;
}
export function ofPaths(this: any, holder: any, key: string) {
  return this.value instanceof holder.inner[key].list[0];
}
export function withoutTypes(left: unknown, right: unknown) {
  return (left as object)! instanceof <any>right;
}
export function ofLiterals(right: any) {
  return [(null as any) instanceof right, (undefined as any) instanceof right, (true as any) instanceof right];
}
export function ofACall(left: any, right: () => any) {
  return left instanceof right();
}
export function ofAVariableUsedOnce(left: any, right: () => any) {
  const local = right();
  return left instanceof local;
}
export function ofAVariableUsedTwice(left: any, right: () => any) {
  const local = right();
  return [left instanceof local, local];
}
