// RUN: link
// CHECK: variable {{*}}name="Named" {{*}}declared={type=function|absent flags=[IsFromCompiler]}
// CHECK: function {{*}}kind=Module
// CHECK: [[parent]] = Data
// CHECK-NEXT: = ResolveHeritage [[parent]]
// CHECK-NOT: NewClass
// CHECK: Return

// RUN(ABSENT): link
// ABSENT-NOT: kind=DerivedConstructor

// Of a class that nothing reads only the test of its parent stays. The test runs in the scope of the class's own name, and the name
// is not typed by a constructor that the program does not have.
const Unused = class Named extends {} {
  m() {
    return Named;
  }
};
