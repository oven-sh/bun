// A literal under `satisfies` is born with the layout of the type that is written, as under an annotation: of a union, with that of the member that its discriminants pick.
// The whole has the type of the literal, which lists only the names that are written there: a layout of its own would have no place for `hidden`.
// RUN: lower
// CHECK-LABEL: function {{*}}name="annotated"
// CHECK: = NewObject {{*}}layout=[[local]] fields=
// CHECK-LABEL: function {{*}}name="other"
// CHECK-NOT: layout=[[local]]
// CHECK: = NewObject {{*}}layout=[[prompt]] fields=
// CHECK-LABEL: function {{*}}name="satisfied"
// CHECK: = NewObject {{*}}layout=[[local]] fields=

// RUN(FIELDS): link
// FIELDS: layout {{*}}fields=[{key="call"{{*}}{key="hidden"{{*}}{key="name"{{*}}{key="type"
// FIELDS: layout {{*}}fields=[{key="hidden"{{*}}{key="name"{{*}}{key="progress"{{*}}{key="type"
// FIELDS-NOT: layout {{*}}fields=[{key="call"{{*}}{key="name"
// FIELDS: function

type Base = { name: string; hidden?: boolean };
type Local = { type: "local"; call(text: string): string };
type Prompt = { type: "prompt"; progress: string };
type Command = Base & (Local | Prompt);

export function annotated(name: string) {
  const made: Command = { type: "local", name, call: text => text };
  return made;
}

export function satisfied(name: string) {
  return { type: "local", name, call: text => text } satisfies Command;
}

export function other(name: string) {
  return { type: "prompt", name, progress: name } satisfies Command;
}
