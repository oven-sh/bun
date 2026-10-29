// RUN: link
// CHECK: layout [[a]] kind=Instance name="A"
// CHECK: layout {{*}}kind=Instance name="B" {{*}} base=[[a]] {{*}}fields=[{key="y"
// CHECK-NOT: {key=
// CHECK: supertypes=[{{*}}[[a]]] flags=[HasHeritage]

// RUN(IMPORTED): link
// IMPORTED: layout [[base]] kind=Instance name="Base"
// IMPORTED: layout {{*}}kind=Instance name="Far" {{*}} base=[[base]] {{*}}fields=[{key="z"
// IMPORTED-NOT: {key=
// IMPORTED: supertypes=[{{*}}[[base]]] flags=[HasHeritage]

import { Base } from "./imports/base";

export class A {
  x = 1;
}

export class B extends A {
  y = 2;
}

export class Far extends Base {
  z = 3;
}
