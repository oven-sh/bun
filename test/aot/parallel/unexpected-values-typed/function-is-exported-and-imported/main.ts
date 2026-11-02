// Alone: it prints the path that one of its files has in the executable
import * as again from "./again.ts";
import { honestElsewhere } from "./honest-caller.ts";
import code, { halved, insideTheLibrary, Scale, sum, total } from "./library.ts";
import * as library from "./library.ts";
import { attempt, log } from "./print.ts";
import { untypedCalls } from "./untyped-caller.js";

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

function honest(label: string): void {
  console.log(label, total([1, 2]), sum({ x: 1, y: 2 }), code("a"), halved(3), new Scale(2).apply(3), insideTheLibrary(), honestElsewhere(2), library.total([4]), again.total([5]), again.codeAgain("b"));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestElsewhere(i) + total([i]) + library.halved(i);
console.log("2000 honest rounds", warm);

const lists = ["[1, 2]", "[1, '2']", "[1, , 3]", "{ length: 2, 0: 1, 1: 2 }", "'12'", "new Uint8Array([1, 2])", "null"];
for (const text of lists) {
  attempt("imported total " + text, () => total(hidden(text)));
  attempt("namespace total " + text, () => library.total(hidden(text)));
  attempt("exported again total " + text, () => again.total(hidden(text)));
  attempt("namespace by name total " + text, () => (library as any)[hidden("'total'")](hidden(text)));
}
for (const text of ["{ x: 1, y: 2 }", "{ x: '1', y: 2 }", "{ x: 1 }", "{ get x() { note('get-x'); return 1; }, y: 2 }", "5", "null"]) {
  attempt("imported sum " + text, () => sum(hidden(text)));
  attempt("namespace sum " + text, () => library.sum(hidden(text)));
}
for (const text of ["'abc'", "new String('abc')", "['a']", "65", "null"]) {
  attempt("default import code " + text, () => code(hidden(text)));
  attempt("namespace default " + text, () => library.default(hidden(text)));
  attempt("exported again code " + text, () => again.codeAgain(hidden(text)));
}
for (const text of ["3", "'3'", "3n", "-0", "{ valueOf() { note('valueOf'); return 3; } }", "undefined"]) {
  attempt("renamed export " + text, () => halved(hidden(text)));
  attempt("imported class, constructor " + text, () => new Scale(hidden(text)).apply(2));
  attempt("imported class, method " + text, () => new Scale(2).apply(hidden(text)));
}

const calls = untypedCalls(log);
for (let i = 0; i < calls.length; i++) attempt("untyped caller " + i, calls[i]);

const late = await import(hidden("'./lib' + 'rary.ts'"));
attempt("loaded by a computed name", () => late.total(hidden("'12'")) + "/" + late.halved(hidden("'8'")) + "/" + (late.total === total));

honest("honest after");
/* Output:
honest before 3 3 98 1.5 6 112 119 4 5 99
2000 honest rounds 12214000
imported total [1, 2] -> 3 
namespace total [1, 2] -> 3 
exported again total [1, 2] -> 3 
namespace by name total [1, 2] -> 3 
imported total [1, '2'] -> "12" 
namespace total [1, '2'] -> "12" 
exported again total [1, '2'] -> "12" 
namespace by name total [1, '2'] -> "12" 
imported total [1, , 3] -> NaN 
namespace total [1, , 3] -> NaN 
exported again total [1, , 3] -> NaN 
namespace by name total [1, , 3] -> NaN 
imported total { length: 2, 0: 1, 1: 2 } -> 3 
namespace total { length: 2, 0: 1, 1: 2 } -> 3 
exported again total { length: 2, 0: 1, 1: 2 } -> 3 
namespace by name total { length: 2, 0: 1, 1: 2 } -> 3 
imported total '12' -> "012" 
namespace total '12' -> "012" 
exported again total '12' -> "012" 
namespace by name total '12' -> "012" 
imported total new Uint8Array([1, 2]) -> 3 
namespace total new Uint8Array([1, 2]) -> 3 
exported again total new Uint8Array([1, 2]) -> 3 
namespace by name total new Uint8Array([1, 2]) -> 3 
imported total null threw TypeError 
namespace total null threw TypeError 
exported again total null threw TypeError 
namespace by name total null threw TypeError 
imported sum { x: 1, y: 2 } -> 3 
namespace sum { x: 1, y: 2 } -> 3 
imported sum { x: '1', y: 2 } -> "12" 
namespace sum { x: '1', y: 2 } -> "12" 
imported sum { x: 1 } -> NaN 
namespace sum { x: 1 } -> NaN 
imported sum { get x() { note('get-x'); return 1; }, y: 2 } -> 3 get-x
namespace sum { get x() { note('get-x'); return 1; }, y: 2 } -> 3 get-x
imported sum 5 -> NaN 
namespace sum 5 -> NaN 
imported sum null threw TypeError 
namespace sum null threw TypeError 
default import code 'abc' -> 100 
namespace default 'abc' -> 100 
exported again code 'abc' -> 100 
default import code new String('abc') -> 100 
namespace default new String('abc') -> 100 
exported again code new String('abc') -> 100 
default import code ['a'] threw TypeError 
namespace default ['a'] threw TypeError 
exported again code ['a'] threw TypeError 
default import code 65 threw TypeError 
namespace default 65 threw TypeError 
exported again code 65 threw TypeError 
default import code null threw TypeError 
namespace default null threw TypeError 
exported again code null threw TypeError 
renamed export 3 -> 1.5 
imported class, constructor 3 -> 6 
imported class, method 3 -> 6 
renamed export '3' -> 1.5 
imported class, constructor '3' -> 6 
imported class, method '3' -> 6 
renamed export 3n threw TypeError 
imported class, constructor 3n threw TypeError 
imported class, method 3n threw TypeError 
renamed export -0 -> -0 
imported class, constructor -0 -> -0 
imported class, method -0 -> -0 
renamed export { valueOf() { note('valueOf'); return 3; } } -> 1.5 valueOf
imported class, constructor { valueOf() { note('valueOf'); return 3; } } -> 6 valueOf
imported class, method { valueOf() { note('valueOf'); return 3; } } -> 6 valueOf
renamed export undefined -> NaN 
imported class, constructor undefined -> NaN 
imported class, method undefined -> NaN 
untyped caller 0 -> "012" 
untyped caller 1 -> "12" 
untyped caller 2 -> NaN 
untyped caller 3 threw TypeError 
untyped caller 4 -> "12" 
untyped caller 5 -> 3 get-x
untyped caller 6 -> NaN 
untyped caller 7 threw TypeError 
untyped caller 8 threw TypeError 
untyped caller 9 -> 4 
untyped caller 10 threw TypeError 
untyped caller 11 -> 4 valueOf
untyped caller 12 -> 6 
untyped caller 13 -> 6 
untyped caller 14 -> NaN 
untyped caller 15 threw TypeError 
exit code 1
error: Cannot load '/$bunfs/root/library.ts': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
