// Fixed seeds of fuzz/definitions-that-throw-half-way-inside-a-try-and-what-their-variables-hold.ts: classes are defined inside try blocks, and the definition may
// throw at what stands behind `extends`, at a computed key, a static field or a static block. The variables that would have taken the class are used afterwards.
import { generate } from "../definitions-that-throw-half-way-inside-a-try-and-what-their-variables-hold";
import { Random } from "../random";
import { family } from "../family";

export default family("variables hold what they hold in plain Bun behind a class definition that threw", [
  {
    name: "a class that extends undefined inside a try, and new of its variable.",
    make: () => ({
      file: "main.ts",
      text: `let base: any = undefined;\nlet held: any = undefined;\ntry {\n  class Heir extends base {}\n  held = Heir;\n} catch {}\ntry {\n  new held();\n} catch (error) {\n  console.log((error as Error).name);\n}\nconsole.log(held);\n`,
    }),
  },
  ...Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  })),
]);
