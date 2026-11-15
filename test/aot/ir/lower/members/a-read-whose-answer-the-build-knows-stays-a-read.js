// RUN: lower
// The build knows what these answer. `process` adds `versions`, `release` and `isBun` to its own properties where each is first read, which shows in the order of its keys,
// and no constant names such a member: the read stays, with a value that nobody takes.
// What lies below such a member belongs to an object that is made whole: only the way to it is read.
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="versions"
// CHECK-NOT: key="bun"
// CHECK: = String string="string"
// CHECK-LABEL: function {{*}}name="kind"
// CHECK: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="versions"
// CHECK-NEXT: = String string="object"
// CHECK-LABEL: function {{*}}name="missing"
// CHECK: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="isBun"
// CHECK-NEXT: = Boolean
// Here too.
// CHECK-LABEL: function {{*}}name="name"
// CHECK: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="release"
// CHECK-NOT: key="name"
// CHECK: = Boolean
// CHECK-LABEL: function {{*}}name="template"
// CHECK: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="release"
// CHECK-NEXT: = Builtin builtin=ObjectCreate
// CHECK-NEXT: = String string="object function"
// CHECK-LABEL: function {{*}}name="throughTheGlobalObject"
// CHECK: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="versions"
// CHECK-NEXT: = String string="object"
export function kind() {
  return typeof process.versions;
}
export function missing() {
  return process.isBun == null;
}
export function name() {
  return process.release.name === "node";
}
export function chain() {
  return typeof process?.versions?.bun;
}
export function template() {
  return `${typeof process.release} ${typeof Object.create}`;
}
export function throughTheGlobalObject() {
  return typeof globalThis.process.versions;
}
