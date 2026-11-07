// RUN: link
// CHECK: layout [[c]] kind=Instance name="C" {{*}}staticFields=[{key="a" variable=[[a]]}]
// CHECK: variable [[a]] module={{*}}owner=[[c]]

// RUN(OWNED): link
// OWNED: layout [[c]] kind=Instance name="C"
// OWNED-COUNT-1: variable {{*}}owner=[[c]]
// OWNED-NOT: variable {{*}}owner=[[c]]

// RUN(PRIVATE): link
// PRIVATE-NOT: staticFields={{*}}key=#"#b"

export class C {
  static a = 1;
  static #b = 2;
  static a = 3;
  static 0 = 4;
}
