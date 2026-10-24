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
