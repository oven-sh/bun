// RUN: lower
// OPTIONS: builtin-modules
// The load of node:os shows nowhere, so no import statement runs the module, and the loader fills the variable of `EOL` where the module first runs.
// A read that finds the variable empty asks for the module and reads again. One that finds it filled makes the one test that a read of any variable makes.
// CHECK: [[first]] = GetModuleVariable variable=[[eol]]
// CHECK-NEXT: [[isEmpty]] = TypeTest [[first]] testedType=absent
// CHECK-NEXT: Branch [[isEmpty]]
// CHECK-NEXT: frequency=Unlikely:
// CHECK-NEXT: = RequireModule {{*}}specifier="node:os"
// CHECK-NEXT: [[again]] = GetModuleVariable variable=[[eol]]
// CHECK-NEXT: = CheckInitialized [[again]] name="EOL"
// CHECK-NOT: CheckInitialized {{*}} name="EOL"
// The load of node:http shows: the loader has filled `METHODS` where the file was linked.
// CHECK: [[methods]] = GetModuleVariable
// CHECK-NEXT: = CheckInitialized [[methods]] name="METHODS"
// A loop that reads the name has the module run in front of it. The read in the loop is the read of the variable alone.
// CHECK-LABEL: function {{*}}name="lines"
// CHECK: = RequireModule {{*}}specifier="node:os"
// CHECK: LoopHint
// CHECK-NOT: RequireModule
// CHECK: [[inLoop]] = GetModuleVariable
// CHECK-NEXT: = CheckInitialized [[inLoop]] name="EOL"
import { EOL } from "node:os";
import { METHODS } from "node:http";
export function lines(texts) {
  let joined = "";
  for (const text of texts) joined += text + EOL;
  return joined;
}
console.log(EOL, METHODS.length);
