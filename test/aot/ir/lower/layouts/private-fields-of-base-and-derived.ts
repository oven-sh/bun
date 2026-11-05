// RUN: link
// CHECK: layout [[a]] kind=Instance name="A" {{*}}key=#"#x"@[[a]] declared=
// CHECK: layout [[b]] kind=Instance name="B" {{*}}key=#"#x"@[[b]] declared=

// RUN(ORIGIN): link
// ORIGIN-NOT: layout {{*}}name="B"{{*}}originLayout=

export class A {
  #x = 1;
}

export class B extends A {
  #x = 2;
}
