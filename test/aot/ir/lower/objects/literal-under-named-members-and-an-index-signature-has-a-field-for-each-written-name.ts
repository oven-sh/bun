// RUN: link
// CHECK: layout [[options]] name="Options" {{*}}fields=[{key="name"
// CHECK: layout [[own]] module={{*}}fields=[{key="extra" {{*}}{key="name" {{*}}supertypes=[
// CHECK: function {{*}}name="create" module=
// CHECK-NOT: = NewDictionary
// CHECK: [[head]] = NewObject {{*}}layout=[[own]] fields=[1, 0]
// CHECK-NEXT: = FinishObject [[head]]
// CHECK: function {{*}}name="declared" module=
// CHECK-NOT: = NewDictionary
// CHECK: = NewObject {{*}}layout=[[options]] fields=[0]
// CHECK: data {{*}}root=Object{layout=[[own]] members=

// RUN(FIELDS): link
// FIELDS-NOT: layout {{*}}name="Options"{{*}}}, {key=

// RUN(FINITE): lower
// FINITE-LABEL: function {{*}}name="finite"
// FINITE-NOT: = NewDictionary
// FINITE: [[pair]] = NewObject -, [[a]], [[b]] layout=
// FINITE-NEXT: = FinishObject [[pair]]
// FINITE-LABEL: function {{*}}name="untyped"
// FINITE-NOT: = NewDictionary
// FINITE: = Data data=d
// FINITE-NOT: = NewDictionary
// FINITE: Return

// A type that names a member has a layout, whatever else it lets in, and a literal that writes the named members alone has that layout. A literal that also writes a name that only the index signature covers has a layout of its own below it, with a field for each name it writes. A literal of constants under such a type stays a record of data. `Record` over a union of names has those names as members and no index signature. The type of an empty literal that is written under no type has no index signature either.
interface Options {
  name: string;
  [key: string]: unknown;
}

export function create(name: string, extra: number) {
  const options: Options = { name, extra };
  return options;
}

export function declared(name: string) {
  const options: Options = { name };
  return options;
}

export function finite(a: number, b: number) {
  const pair: Record<"a" | "b", number> = { a, b };
  return pair;
}

export function untyped() {
  return {};
}

export const fixed: Options = { name: "a", extra: 1 };
