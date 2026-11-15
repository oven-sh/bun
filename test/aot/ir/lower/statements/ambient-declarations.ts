// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: PutModuleVariable
// CHECK-NOT: NewClass
// CHECK-NOT: NewClosure
// CHECK: Return
// CHECK-NOT: function [[other]]

declare let a: number;
declare function f(): void;
declare class C {}
interface I {}
type T = number;
export {};
