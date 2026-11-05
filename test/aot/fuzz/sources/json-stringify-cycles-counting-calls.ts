// A fixed list of seeds of ../json-stringify-cycles-counting-calls.ts, which describes the programs.
import { Random } from "../random";
import { generate } from "../json-stringify-cycles-counting-calls";
import { family } from "../family";

export default family(
  "json stringify cycles counting calls",
  [
    {
      name: "toJSON of a record that holds itself runs once.",
      make: () => ({
        file: "main.ts",
        text: `let calls = 0;\ninterface Holder { self: Holder | null; toJSON(): unknown }\nconst holder: Holder = { self: null, toJSON() { calls++; return { self: this.self }; } };\nholder.self = holder;\ntry { JSON.stringify(holder); } catch (error) { console.log((error as Error).name); }\nconsole.log(calls);\n`,
      }),
    },
    ...Array.from({ length: 160 }, (_, index) => ({
      name: `seed ${index + 1}.`,
      flags:
        index % 8 === 5 ? ["--aot-heat=everything-is-hot"] : index % 8 === 6 ? ["--aot-heat=everything-is-cold"] : [],
      make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
    })),
  ],
);
