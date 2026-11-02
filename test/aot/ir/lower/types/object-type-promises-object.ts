// RUN: link
// CHECK: layout [[class]] kind=Instance name="C" module=[[entry]]
// CHECK: layout [[record]] module=[[entry]] {{*}}fields=[{key="x"
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|[[class]] site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|[[record]] site=
// CHECK: module [[entry]] path=

// RUN(FUNCTIONS): lower
// FUNCTIONS-NOT: type=undefined|null|object
// FUNCTIONS: = NewClass {{*}}layout=[[class]]
// FUNCTIONS-NOT: type=undefined|null|object
// FUNCTIONS: [[a]] = Convert {{*}}declared={type=undefined|null|[[class]] site=
// FUNCTIONS-NEXT: PutModuleVariable [[a]]
// FUNCTIONS-NOT: type=undefined|null|object
// FUNCTIONS: [[b]] = Convert {{*}}declared={type=undefined|null|L{{*}} site=
// FUNCTIONS-NEXT: PutModuleVariable [[b]]
// FUNCTIONS-NOT: type=undefined|null|object

// The type of a class or of an object type is its layout, with a site: the position is checked against the layout, not against `object`.
export class C {
  x = 1;
}

export let a: C, b: { x: number };
