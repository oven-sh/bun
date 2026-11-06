// Flags: --aot-heat=everything-is-cold --aot-disable=flow-results
// Erased types: not built: number-literal-stays-numeric is built so
import "../../fixtures/jsc-shell-functions.ts";
import "./number-literal-stays-numeric/program.ts";
/* Output:
written: ArrayWithDouble [31,28,31,30] 120
workedOut: ArrayWithDouble [31,28,31,30] 120
halves: ArrayWithDouble [0.5,1.5] 2
writtenResult: ArrayWithContiguous [1,2] 3
workedOutResult: ArrayWithContiguous [1,2] 3
constants: ArrayWithDouble [1,2,3] 6
nested: ArrayWithDouble [3,4] 7
inAnObject: ArrayWithDouble [31,28] 59
texts: ArrayWithContiguous ["a","b"]
mixed: ArrayWithContiguous [1,"a"]
asAny: ArrayWithContiguous [1,2,3]
tuple: ArrayWithInt32 [1,2]
outer: ArrayWithContiguous [[1,2],[3,4]]
*/
