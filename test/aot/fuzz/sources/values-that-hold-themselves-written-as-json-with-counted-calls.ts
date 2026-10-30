// Fixed seeds of fuzz/values-that-hold-themselves-written-as-json-with-counted-calls.ts: records, instances, lists and proxies are linked so that some hold
// themselves, and JSON.stringify writes them. Every toJSON, getter, trap and replacer counts its calls; the text or the error, the counts and the order are printed.
import { Random } from "../random";
import { generate } from "../values-that-hold-themselves-written-as-json-with-counted-calls";
import { family } from "../family";

export default family(
  "JSON.stringify runs the code of the program as often and in the order of plain Bun where a value holds itself",
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
