// A fixed list of seeds of ../class-definition-throws-in-try.ts, which describes the programs.
import { generate } from "../class-definition-throws-in-try";
import { Random } from "../random";
import { family } from "../family";

export default family("class definition throws in try", [
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
