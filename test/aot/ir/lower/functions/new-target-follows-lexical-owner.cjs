// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: [[top]] = Undefined
// CHECK: = NewArray {{*}}, [[top]] contents=
// CHECK-LABEL: function {{*}}name="F"{{*}}HasNewTarget
// CHECK: b0([[newTarget]]: anything):
// CHECK: = NewClosure [[newTarget]] function=
// CHECK-LABEL: function {{*}}name="method"{{*}}kind=Method
// CHECK: [[inMethod]] = Undefined
// CHECK-NEXT: = Call [[use]], -, [[inMethod]]
// CHECK-LABEL: function {{*}}kind=Arrow{{*}}captures=[{type=anything}]
// CHECK: b0([[copy]]: anything):
// CHECK-NOT: = Undefined
// CHECK: [[result]] = [[cast]] [[copy]]
// CHECK-NEXT: Return [[result]]

// RUN(MAIN): lower
// MAIN-NOT: kind=CommonJsModule{{*}}HasNewTarget
// MAIN-NOT: name="method"{{*}}HasNewTarget
// MAIN-NOT: kind=Arrow{{*}}HasNewTarget
// MAIN-NOT: GetEnvironmentField

function F() {
  return () => new.target;
}

const object = {
  method(use) {
    use(new.target);
  },
};

module.exports = [F, object, new.target];
