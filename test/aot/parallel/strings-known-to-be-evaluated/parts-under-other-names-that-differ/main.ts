// What namespaces and numbers of other files hold is only a guess of the text: the program evaluates the string that it has.
import * as parts from "./parts";
import { change, CHANGING, COUNT, FIXED as first, FIXED as second, HUGE, LIMIT, NONE, ODD } from "./parts";
import { later } from "./cycle";

export const OWN = 3;
const run = (text: string) => new Function(text)();
console.log(run(parts.FIXED), run(first), run(second), run("return " + parts.CHANGING), run("return " + CHANGING));
change();
console.log(run(parts.FIXED), run(first), run(second), run("return " + parts.CHANGING), run("return " + CHANGING));
for (const name of ["FIXED", "TEXT", "absent"] as const) {
  try {
    console.log(name, run((parts as any)[name]));
  } catch (error) {
    console.log(name, (error as Error).name);
  }
}
console.log(run("return " + (parts as any).absent), run("return " + (parts as any)["absent"]));
console.log(run(`return [${COUNT}, ${-COUNT}, ${COUNT / 2}, ${parts.COUNT + 1}, ${LIMIT}].join()`));
console.log(run(`return typeof (${HUGE}n)`), run(`return ${NONE}`), run(`return Object.is(${ODD}, ${ODD})`));
{
  const parts = { FIXED: "return 'shadowed';", COUNT: 100 };
  console.log(run(parts.FIXED), run("return " + parts.COUNT));
}
console.log(((parts: { FIXED: string }) => run(parts.FIXED))({ FIXED: "return 'passed';" }));
console.log(((first: string) => run(first))("return 'passed too';"), run(later()));
const { FIXED, COUNT: count } = parts;
console.log(run(FIXED), run("return " + count));
console.log(run(parts.settings.text), run("return " + parts.settings.limit), run(parts.settings["text"]));
parts.settings.text = "return 'of changed settings';";
parts.settings.limit = 30;
console.log(run(parts.settings.text), run("return " + parts.settings.limit), run(parts.settings["text"]));
console.log(run(parts.default), run("return " + parts.default.length));
