// Counts heap cells to show that a class's methods and prototype are created only when something first looks at them.
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";
/* Output:
heap cells of four kinds, more than at the line before
nothing happened: Function +0, NativeExecutable +0, Structure +0, GetterSetter +0
new C and four typed calls: Function +0, NativeExecutable +0, Structure +1, GetterSetter +0
the snapshot has looked at C: Function +5, NativeExecutable +0, Structure +1, GetterSetter +0
new B extends A and three typed calls: Function +0, NativeExecutable +0, Structure +2, GetterSetter +0
the snapshot has looked at B and A: Function +6, NativeExecutable +0, Structure +2, GetterSetter +0
new A: Function +0, NativeExecutable +0, Structure +1, GetterSetter +0
18 3
*/
