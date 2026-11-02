// RUN: link
// CHECK: layout [[i]] name="I"
// CHECK: function {{*}}name="create"
// CHECK: = NewObject {{*}}layout=[[i]] fields=[0]
// CHECK: data {{*}}root=Object{layout=[[i]] members=

// RUN(OWN): link
// OWN: layout [[own]] module={{*}}fields=[{key="b"
// OWN: function {{*}}name="plain"
// OWN: = NewObject {{*}}layout=[[own]] fields=[0]

interface I {
  a: number;
}

export function create(a: number) {
  const v: I = { a };
  return v;
}

export function plain(b: number) {
  return { b };
}

export const fixed: I = { a: 1 };
