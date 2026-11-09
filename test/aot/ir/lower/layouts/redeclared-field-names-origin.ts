// RUN: link
// CHECK: layout [[a]] kind=Instance name="A"
// CHECK: layout {{*}}kind=Instance name="B" {{*}}fields=[{key="x" declared={type={{*}}} flags=[IsRequired] originLayout=[[a]] originField=0}]

// RUN(BASE): link
// BASE-NOT: layout {{*}}name="A"{{*}}originLayout=

export class A {
  x: number = 1;
}

export class B extends A {
  x = 2;
}
