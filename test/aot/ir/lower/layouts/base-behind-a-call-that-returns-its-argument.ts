// RUN: link
// CHECK: layout {{*}}kind=Instance name="B" {{*}} base=

function mixin(c: any): any {
  return c;
}

class A {}

export class B extends mixin(A) {}
