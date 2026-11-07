// RUN: link
// CHECK: variable [[t]] name="t" {{*}}flags=[IsImmutable]
// CHECK: [[value]] = Call {{*}}calleeName="make"
// CHECK: PutModuleVariable [[value]] variable=[[t]]
// CHECK: = Call {{*}}, -, [[value]] calleeName="use"

// RUN(READS): lower
// READS-LABEL: function {{*}}kind=Module
// READS-NOT: GetModuleVariable
// READS-LABEL: function {{*}}name="get"
// READS-NOT: captures=
// READS: = GetModuleVariable

declare function make(): unknown;
declare function use(value: unknown): void;

const t = make();
export const get = () => t;
use(t);
