// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="b" declared={type={{*}}} flags=[IsRequired]}, {key="a" declared={type={{*}}} flags=[IsRequired]}, {key="c" declared={type=

// RUN(OPTIONAL): link
// OPTIONAL-NOT: layout {{*}}name="C"{{*}}key="c"{{*}}IsRequired

// RUN(METHOD): link
// METHOD-NOT: layout {{*}}name="C"{{*}}key="m"

export class C {
  b = 1;
  a: string = "";
  m() {}
  c?: number;
}
