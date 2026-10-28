// Small programs that TypeScript accepts under one value of one compiler option and refuses under the other, and every way to say the option. A build accepts what TypeScript accepts, and for eighteen of the
// options it refuses what TypeScript refuses, with the same error.
// Where the program is accepted it runs: under `strictNullChecks: false` a `number` holds `null` with nothing to hide it, and the executable prints what plain Bun prints. In this order are drawn:
//
//   the option     strictNullChecks, strictPropertyInitialization, noImplicitAny, noImplicitThis, useUnknownInCatchVariables, strictFunctionTypes, strictBindCallApply; noUncheckedIndexedAccess,
//                  exactOptionalPropertyTypes, noImplicitReturns, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters, allowUnreachableCode, allowUnusedLabels, noImplicitOverride,
//                  noPropertyAccessFromIndexSignature, erasableSyntaxOnly, allowImportingTsExtensions, resolveJsonModule, lib, types
//   the program    one of several that hang on the option
//   the verdict    accepted or refused
//   how it is said the option itself; `strict` alone; `strict` and the option against it; in a file that tsconfig.json extends; there, and the other way round in tsconfig.json; in the later of two files that it
//                  extends; in a package that it extends; between comments and behind trailing commas; in a tsconfig.json above the folder of the sources
//   where it lies  in the first file, or in a file that the first file imports
import type { Random } from "./random";

/** `on` is the value under which TypeScript reports `error`. `isStrict`: `strict` switches it on. */
type Hinge = {
  on: unknown;
  off: unknown;
  isStrict?: true;
  needs?: Record<string, unknown>;
  programs: [error: string, text: string][];
  files?: Record<string, string>;
};

const hinges: Record<string, Hinge> = {
  strictNullChecks: {
    on: true,
    off: false,
    isStrict: true,
    programs: [
      ["TS2322", "const count: number = null;\nconsole.log(count, count + 1);"],
      ["TS2322", "let text: string = undefined;\nconsole.log(typeof text);"],
      [
        "TS2345",
        "function size(text: string) {\nreturn text === null ? -1 : text.length;\n}\nconsole.log(size(null));",
      ],
      [
        "TS2322",
        "const list: number[] = [1, null, 3];\nlet sum = 0;\nfor (const each of list) sum += each;\nconsole.log(sum);",
      ],
      ["TS2322", "class Holder {\nvalue: number = null;\n}\nconsole.log(new Holder().value, new Holder().value + 1);"],
      ["TS18048", "const found = [1, 2].find(each => each > 5);\nconsole.log(found + 1);"],
      [
        "TS2322",
        `const map = new Map<string, number>();\nconst got: number = map.get("key");\nconsole.log(got, got * 2);`,
      ],
      [
        "TS2322",
        "function made(flag: boolean): { a: number } {\nreturn flag ? { a: 1 } : null;\n}\nconsole.log(made(false) === null, made(true).a);",
      ],
      [
        "TS2322",
        "const holder: { a: number; b: string } = { a: undefined, b: null };\nconsole.log(holder.a + 1, typeof holder.b, Object.keys(holder).join());",
      ],
      [
        "TS2345",
        "const kept: number[] = [];\nkept.push(undefined);\nlet sum = 0;\nfor (let turn = 0; turn < 10000; turn++) sum += kept[0];\nconsole.log(sum);",
      ],
      ["TS2531", `const texts: (string | null)[] = ["a"];\nconsole.log(texts[0].length);`],
    ],
  },
  strictPropertyInitialization: {
    on: true,
    off: false,
    isStrict: true,
    needs: { strictNullChecks: true },
    programs: [
      ["TS2564", `class Holder {\nvalue: number;\n}\nconsole.log(new Holder().value, "value" in new Holder());`],
      [
        "TS2564",
        "class Holder {\nvalue: number;\nother = 1;\nsum() {\nreturn this.value + this.other;\n}\n}\nconsole.log(new Holder().sum());",
      ],
      [
        "TS2564",
        'class Holder {\ntext: string;\nconstructor(flag: boolean) {\nif (flag) this.text = "set";\n}\n}\nconsole.log(typeof new Holder(false).text, new Holder(true).text);',
      ],
    ],
  },
  noImplicitAny: {
    on: true,
    off: false,
    isStrict: true,
    programs: [
      ["TS7006", `function twice(x) {\nreturn x + x;\n}\nconsole.log(twice(2), twice("a"));`],
      ["TS7053", `const table = { a: 1 };\nconst key: string = "a";\nconsole.log(table[key]);`],
      ["TS7031", "function first({ a }) {\nreturn a;\n}\nconsole.log(first({ a: 1 }));"],
      ["TS7019", "function count(...all) {\nreturn all.length;\n}\nconsole.log(count(1, 2));"],
    ],
  },
  noImplicitThis: {
    on: true,
    off: false,
    isStrict: true,
    programs: [["TS2683", "function who() {\nreturn typeof this;\n}\nconsole.log(who());"]],
  },
  useUnknownInCatchVariables: {
    on: true,
    off: false,
    isStrict: true,
    needs: { strictNullChecks: true },
    programs: [
      ["TS18046", `try {\nthrow { message: "thrown" };\n} catch (error) {\nconsole.log(error.message);\n}`],
      ["TS18046", "try {\nthrow 5;\n} catch (error) {\nconsole.log(error + 1);\n}"],
    ],
  },
  strictFunctionTypes: {
    on: true,
    off: false,
    isStrict: true,
    programs: [
      [
        "TS2322",
        `const narrow = (x: number) => x + 1;\nconst wide: (x: number | string) => number = narrow;\nconsole.log(wide("text"));`,
      ],
      [
        "TS2345",
        `function each(visit: (x: number | string) => void) {\nvisit("text");\n}\neach((x: number) => console.log(x * 2));`,
      ],
    ],
  },
  strictBindCallApply: {
    on: true,
    off: false,
    isStrict: true,
    programs: [
      ["TS2345", `function twice(x: number) {\nreturn x + x;\n}\nconsole.log(twice.call(null, "a"));`],
      ["TS2345", `function twice(x: number) {\nreturn x + x;\n}\nconsole.log(twice.bind(null, "a")());`],
      ["TS2322", `function twice(x: number) {\nreturn x + x;\n}\nconsole.log(twice.apply(null, ["a"]));`],
    ],
  },
  noUncheckedIndexedAccess: {
    on: true,
    off: false,
    needs: { strictNullChecks: true },
    programs: [
      ["TS2322", "const list: number[] = [];\nconst first: number = list[0];\nconsole.log(first, first + 1);"],
      ["TS2532", `const record: Record<string, number> = {};\nconsole.log(record["missing"] + 1);`],
      ["TS2532", `const texts: string[] = ["a"];\nconsole.log(texts[0].length);`],
    ],
  },
  exactOptionalPropertyTypes: {
    on: true,
    off: false,
    needs: { strictNullChecks: true },
    programs: [
      ["TS2375", `const holder: { a?: number } = { a: undefined };\nconsole.log("a" in holder);`],
      ["TS2412", `const holder: { a?: number } = {};\nholder.a = undefined;\nconsole.log(Object.keys(holder).join());`],
    ],
  },
  noImplicitReturns: {
    on: true,
    off: false,
    programs: [["TS7030", "function picked(flag: boolean) {\nif (flag) return 1;\n}\nconsole.log(picked(false));"]],
  },
  noFallthroughCasesInSwitch: {
    on: true,
    off: false,
    programs: [["TS7029", `switch ([1][0]) {\ncase 1:\nconsole.log("one");\ncase 2:\nconsole.log("two");\n}`]],
  },
  noUnusedLocals: {
    on: true,
    off: false,
    programs: [
      ["TS6133", `const unused = 1;\nconsole.log("ran");\nexport {};`],
      ["TS6133", `let unused = 1;\nconsole.log("ran");\nexport {};`],
    ],
  },
  noUnusedParameters: {
    on: true,
    off: false,
    programs: [["TS6133", "function one(unused: number) {\nreturn 1;\n}\nconsole.log(one(2));"]],
  },
  allowUnreachableCode: {
    on: false,
    off: true,
    programs: [["TS7027", `function one() {\nreturn 1;\nconsole.log("never");\n}\nconsole.log(one());`]],
  },
  allowUnusedLabels: { on: false, off: true, programs: [["TS7028", `label: console.log("ran");`]] },
  noImplicitOverride: {
    on: true,
    off: false,
    programs: [
      [
        "TS4114",
        "class Above {\nread() {\nreturn 1;\n}\n}\nclass Below extends Above {\nread() {\nreturn 2;\n}\n}\nconsole.log(new Below().read());",
      ],
    ],
  },
  noPropertyAccessFromIndexSignature: {
    on: true,
    off: false,
    programs: [["TS4111", "const record: Record<string, number> = { a: 1 };\nconsole.log(record.a);"]],
  },
  erasableSyntaxOnly: {
    on: true,
    off: false,
    programs: [
      ["TS1294", "enum Color {\nRed,\n}\nconsole.log(Color.Red);"],
      ["TS1294", "class Holder {\nconstructor(public value: number) {}\n}\nconsole.log(new Holder(1).value);"],
      ["TS1294", "namespace Inner {\nexport const value = 1;\n}\nconsole.log(Inner.value);"],
    ],
  },
  allowImportingTsExtensions: {
    on: false,
    off: true,
    programs: [["TS5097", `import { value } from "./more.ts";\nconsole.log(value);`]],
    files: { "more.ts": "export const value = 1;\n" },
  },
  resolveJsonModule: {
    on: false,
    off: true,
    programs: [["TS2732", `import data from "./data.json";\nconsole.log(data.a);`]],
    files: { "data.json": `{ "a": 1 }\n` },
  },
  lib: {
    on: ["es5", "dom"],
    off: ["esnext", "dom"],
    programs: [
      ["TS2550", "console.log([1].includes(1));"],
      ["TS2550", `console.log("a".padStart(2).length);`],
    ],
  },
  types: { on: ["missing"], off: [], programs: [["TS2688", `console.log("ran");`]] },
};

export const options = Object.keys(hinges);
/** The options that a build asks about. The others are `bun check`'s: what code is never reached or used, how a path is written, and which libraries and typings the project names. */
export const optionsOfABuild = options.filter(
  option => !["allowUnreachableCode", "allowImportingTsExtensions", "lib", "types"].includes(option),
);

export function generate(
  random: Random,
  option: string = random.pick(options),
  isRefused = random.chance(0.5),
): { file: string; text: string; files: Record<string, string>; isRefused: boolean; error: string } {
  // The relations first.
  const hinge = hinges[option];
  const [error, program] = random.pick(hinge.programs);
  const wanted = isRefused ? hinge.on : hinge.off;
  const other = isRefused ? hinge.off : hinge.on;
  const saying = random.weighted([
    [4, "the option itself"],
    [hinge.isStrict ? 3 : 0, "strict alone"],
    [hinge.isStrict ? 3 : 0, "strict and the option against it"],
    [3, "in a file that is extended"],
    [3, "overridden"],
    [2, "the later of two"],
    [2, "in a package"],
  ] as const);
  const hasComments = random.chance(0.25);
  const isAbove = random.chance(0.25);
  const isInAnotherFile = random.chance(0.4);

  const files: Record<string, string> = {};
  const fixed: Record<string, unknown> = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    ...(option === "types" ? {} : { types: [] }),
  };
  // Whatever else is strict stays out of the way of the one option.
  const quiet: Record<string, unknown> = { strict: false, ...hinge.needs };
  const written = (compilerOptions: object, more: object = {}) => {
    const text = JSON.stringify({ ...more, compilerOptions }, null, 2);
    return (
      (hasComments
        ? "// The project.\n" +
          text
            .replace(/\n  \}\n\}$/, ",\n  }, /* the end */\n}")
            .replace(/("noEmit": true,)/, "$1 // nothing is written")
        : text) + "\n"
    );
  };
  const own = { [option]: wanted };
  const against = { [option]: other };
  switch (saying) {
    case "the option itself":
      files["tsconfig.json"] = written({ ...fixed, ...quiet, ...own });
      break;
    case "strict alone":
      files["tsconfig.json"] = written({ ...fixed, strict: isRefused });
      break;
    case "strict and the option against it":
      files["tsconfig.json"] = written({ ...fixed, ...hinge.needs, strict: !isRefused, ...own });
      break;
    case "in a file that is extended":
      files["base.json"] = written({ ...quiet, ...own });
      files["tsconfig.json"] = written(fixed, { extends: "./base.json" });
      break;
    case "overridden":
      files["base.json"] = written({ ...quiet, ...against });
      files["tsconfig.json"] = written({ ...fixed, ...own }, { extends: "./base.json" });
      break;
    case "the later of two":
      files["first.json"] = written({ ...quiet, ...against });
      files["second.json"] = written(own);
      files["tsconfig.json"] = written(fixed, { extends: ["./first.json", "./second.json"] });
      break;
    case "in a package":
      files["node_modules/shared-project/package.json"] =
        JSON.stringify({ name: "shared-project", version: "1.0.0" }, null, 2) + "\n";
      files["node_modules/shared-project/tsconfig.json"] = written({ ...quiet, ...own });
      files["tsconfig.json"] = written(fixed, {
        extends: random.pick(["shared-project/tsconfig.json", "shared-project/tsconfig", "shared-project"]),
      });
      break;
  }
  const folder = isAbove ? "src/" : "";
  for (const [name, text] of Object.entries(hinge.files ?? {})) files[folder + name] = text;
  if (!isInAnotherFile) return { file: `${folder}main.ts`, text: program + "\n", files, isRefused, error };
  files[`${folder}part.ts`] = program + (/^(?:import|export) /m.test(program) ? "\n" : "\nexport {};\n");
  return { file: `${folder}main.ts`, text: `import "./part";\n`, files, isRefused, error };
}
