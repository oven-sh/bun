// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="b" declared={type={{*}}} flags=[IsRequired] originLayout=[[i]] originField=1}, {key="a" declared={type={{*}}} flags=[IsRequired] originLayout=[[i]] originField=0}] supertypes=[{{*}}[[i]]]
// CHECK: layout [[i]] name="I"

// RUN(HERITAGE): link
// HERITAGE-NOT: layout {{*}}name="C"{{*}} base=
// HERITAGE-NOT: layout {{*}}name="C"{{*}}HasHeritage

interface I {
  a: number;
  b: string;
}

export class C implements I {
  b = "";
  a = 0;
}
