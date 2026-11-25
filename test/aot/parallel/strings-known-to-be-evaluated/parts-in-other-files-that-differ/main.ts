// What other files hold is only a guess of the text: the program evaluates the string that it has.
import { CHANGING, change, FIXED, LATER, object, read } from "./parts";
import * as parts from "./parts";
import { fromCycle, useCycle } from "./cycle";

export const OWN = "return 'own';";
const run = (text: string) => new Function(text)();
console.log(run(FIXED), run(CHANGING), run(LATER), run(object.text), run(read()), run(parts.FIXED));
change();
console.log(run(FIXED), run(CHANGING), run(LATER), run(object.text), run(read()), run(parts.CHANGING));
console.log(new Function(FIXED + (process.argv.length > 100 ? " " : ""))(), new Function(FIXED + " ")());
console.log(new Function("x", "y", `${FIXED.replace("fixed", "replaced")}`)());
console.log(fromCycle(), useCycle());
try {
  console.log(new Function(CHANGING.slice(1))());
} catch (error) {
  console.log((error as Error).name);
}
{
  const FIXED = "return 'shadowed';";
  console.log(new Function(FIXED)());
}
console.log((function (FIXED: string) { return new Function(FIXED)(); })("return 'passed';"));
for (const { text } of [{ text: FIXED }, { text: CHANGING }]) console.log(new Function(text).toString().length > 0, new Function(text)());
