// Counts heap cells to show what is allocated when a class is used as a value.
// Each step makes a cell for each of 30 or 60 classes, or none. A collection may still find a cell or two that only the stack names, so a count is given to the nearest ten.
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";
/* Output:
heap cells of six kinds, more than at the line before, to the nearest ten
declared: Function 0, NativeExecutable 0, Structure 0, PropertyTable 0, GetterSetter 0, Object 0
60 classes as values: Function 0, NativeExecutable 0, Structure 0, PropertyTable 0, GetterSetter 0, Object 0
C.prototype as a value: Function 60, NativeExecutable 0, Structure 60, PropertyTable 60, GetterSetter 0, Object 60
new C through the value, instanceof: Function 0, NativeExecutable 0, Structure 60, PropertyTable 0, GetterSetter 0, Object 60
30 of them looked at: Function 30, NativeExecutable 0, Structure 0, PropertyTable 0, GetterSetter 0, Object 0
all looked at: Function 60, NativeExecutable 0, Structure 0, PropertyTable 0, GetterSetter 0, Object 0
2475
*/
