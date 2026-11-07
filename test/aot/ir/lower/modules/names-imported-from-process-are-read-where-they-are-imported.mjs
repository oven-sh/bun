// RUN: lower
// OPTIONS: builtin-modules
// A link reads every name that a statement imports from "node:process", used or not and in the order of the statement. `process` lists such a member from its first read on.
// The loader fills the variable of a member that a program can store to. No variable holds a member that is locked, so its read is written.
// CHECK: = GetModuleVariable variable=[[cwd]]
// CHECK-NEXT: [[process]] = Builtin builtin=Process
// CHECK-NEXT: = PropGet [[process]] key="release"
// CHECK-NEXT: = GetModuleVariable variable=[[uptime]]
// CHECK-NEXT: = GetModuleVariable variable=[[hrtime]]
// CHECK: [[used]] = GetModuleVariable variable=[[hrtime]]
// CHECK-NEXT: = CheckInitialized [[used]] name="hrtime"
import { cwd } from "node:process";
import { release } from "node:process";
import { uptime, hrtime } from "node:process";
console.log(hrtime);
