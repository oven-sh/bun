// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="x"

// RUN(BRAND): link
// BRAND-NOT: layout {{*}}name="C"{{*}}IsBrand

// RUN(TOKEN): lower
// TOKEN-NOT: NewClassToken

export class C {
  x = 1;
  static #s = 2;
}
