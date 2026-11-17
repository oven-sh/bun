// The declaration of a name that a namespace exports runs as the store `N.Declared = ..`, which names nothing. A class with class decorators has the declared name all the same: Bun's transpiler writes it into the class first.
// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[declared]] = String string="Declared"
// CHECK: = Call {{*}}, -, {{*}}, {{*}}, [[declared]],
// CHECK: PropSet {{*}}key="Declared"
// CHECK: [[asserted]] = String string="Asserted"
// CHECK: = Call {{*}}, -, {{*}}, {{*}}, [[asserted]],
// CHECK: PropSet {{*}}key="Asserted"
// CHECK: [[inList]] = String string="InList"
// CHECK: = Call {{*}}, -, {{*}}, {{*}}, [[inList]],
// CHECK: PropSet {{*}}key="InList"
// CHECK: [[inRecord]] = String string="InRecord"
// CHECK: = Call {{*}}, -, {{*}}, {{*}}, [[inRecord]],
// CHECK: PropSet {{*}}key="InRecord"
// CHECK: [[inAssignedList]] = String string="InAssignedList"
// CHECK: = Call {{*}}, -, {{*}}, {{*}}, [[inAssignedList]],
// CHECK: PropSet {{*}}key="InAssignedList"

// An assignment to such a name is a store when the transpiler comes to it. So is a target in an assigned record. In an assigned list the transpiler reads the name first.
// RUN(ASSIGNED): lower
// ASSIGNED-NOT: String string="Assigned"
// ASSIGNED-NOT: String string="InAssignedRecord"

// RUN(OTHERS): lower
// OTHERS-NOT: name="Undecorated"
// OTHERS-NOT: name="made"
// OTHERS-NOT: name="MemberAlone"
// OTHERS-NOT: name="UndecoratedInList"
// OTHERS-NOT: name="UndecoratedInAssignedList"

declare const on: any;

export namespace N {
  export const Declared = @on class {};
  export const Asserted = (@on class {}) as any;
  export const [InList = @on class {}] = [] as any[];
  export const { InRecord = @on class {} } = {} as any;
  export let InAssignedList: any;
  [InAssignedList = @on class {}] = [] as any[];
  export let InAssignedRecord: any;
  ({ InAssignedRecord = @on class {} } = {} as any);
  export let Assigned: any;
  Assigned = @on class {};
  export const Undecorated = class {};
  export const made = function () {};
  export const MemberAlone = class {
    @on run() {}
  };
  export const [UndecoratedInList = class {}] = [] as any[];
  export let UndecoratedInAssignedList: any;
  [UndecoratedInAssignedList = class {}] = [] as any[];
}
