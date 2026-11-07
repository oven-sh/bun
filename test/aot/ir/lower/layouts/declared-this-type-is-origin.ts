// RUN: link
// CHECK: layout {{*}}kind=Instance name="F" {{*}}fields=[{key="b" {{*}}originLayout=[[i]] originField=1}, {key="a" {{*}}originLayout=[[i]] originField=0}] supertypes=[{{*}}[[i]]] flags=[IsConstructorFunction]
// CHECK: layout [[i]] name="I"

// RUN(UNTYPED): link
// UNTYPED-NOT: layout {{*}}name="G"{{*}}supertypes=
// UNTYPED-NOT: layout {{*}}name="U"{{*}}supertypes=

interface I {
  a: number;
  b: string;
}

function F(this: I) {
  this.b = "";
  this.a = 0;
}

function G(this: any) {
  this.a = 0;
}

function U(this: I | { c: number }) {
  (this as I).a = 0;
}

export const instances = [new (F as unknown as new () => I)(), new (G as any)(), new (U as any)()];
