// RUN: link
// CHECK: layout {{*}}kind=Instance name="C"

// RUN(FIELDS): link
// FIELDS-NOT: layout {{*}}name="C"{{*}}fields=
// FIELDS-NOT: layout {{*}}name="C"{{*}}staticFields=

export class C {
  m() {}
  get g() {
    return 1;
  }
  set s(value: number) {}
  static t() {}
}
