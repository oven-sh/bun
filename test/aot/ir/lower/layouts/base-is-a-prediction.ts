// RUN: link
// CHECK: layout {{*}}kind=Instance name="B" {{*}}flags=[HasHeritage]

// RUN(BASE): link
// BASE-NOT: layout {{*}}name="B"{{*}} base=
// BASE-NOT: layout {{*}}name="B"{{*}}supertypes=

function mixin(c: any): any {
  return c;
}

class A {}

export class B extends mixin(A) {}
