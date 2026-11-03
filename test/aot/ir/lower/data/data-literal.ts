// RUN: link
// CHECK: layout [[row]] name="Row"
// CHECK: data {{*}}root=Array{contents=undefined|null|[[row]] elements=[Object{layout=[[row]] members=[{key="id" value=Number{value=1}}, {key="tag" value=String{value="a"}}]}, Object{layout=[[row]]

// RUN(FRESH): lower
// FRESH-LABEL: function {{*}}name="fresh"
// FRESH-NOT: = NewObject
// FRESH-NOT: = NewArray
// FRESH: = Data data=d
// FRESH-NOT: = Data
// FRESH: Return

interface Row {
  id: number;
  tag: string;
}

export const rows: Row[] = [
  { id: 1, tag: "a" },
  { id: 2, tag: "b" },
];

export function fresh(): Row[] {
  return [{ id: 3, tag: "c" }];
}
