// RUN: link
// CHECK: layout {{*}}name="C"
// CHECK-NOT: supertypes=
// CHECK: layout [[interface]] module={{*}}fields=[{key="x"
// CHECK-NOT: supertypes=
// CHECK: variable {{*}}name="v" module={{*}}declared={type=undefined|null|absent|[[interface]] flags=[OmitsNull, OmitsUndefined]}
// CHECK: = Convert {{*}}declared={type=undefined|null|[[interface]] flags=[OmitsNull, OmitsUndefined]} @

// The initializer is converted to the type that is written, and adds to no family: `C` does not declare that it implements `I`, so it does not go below `I`.
interface I {
  x: number;
}

class C {
  x = 1;
  y = 2;
}

export const v: I = new C();
