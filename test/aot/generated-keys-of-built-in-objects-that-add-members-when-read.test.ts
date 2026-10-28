// Fixed seeds of fuzz/keys-of-built-in-objects-that-add-members-when-read.ts: the own keys of a built-in object stand in the order they have in
// plain Bun, whichever members the program used before and whatever else the listed value could be. There is a program for each object and each
// way of coming by what is listed. Every second one is TypeScript.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunExe } from "harness";
import { generate, holders, numberOfForms } from "./fuzz/keys-of-built-in-objects-that-add-members-when-read";
import { Random } from "./fuzz/random";
import { findBuiltinTable } from "./generate";
import { generated } from "./generated/run-generated";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: ["bun-types"],
  },
});

// Every run takes these, whatever else it takes.
const onceWrong = [
  45, 46, 47, 55, 57, 63, 67, 71, 86, 178, 179, 181, 187, 188, 191, 195, 203, 222, 310, 318, 319, 327, 331, 333, 345,
  351, 372,
];

/** Built without --aot-validate today: a validating build reads at start each object that holds a member it names, here the classes of these two. */
const notValidatedToday = ["Intl", "WebAssembly"];

generated(
  "the keys of a built-in object that adds members when they are read stand in the order of plain Bun",
  Array.from({ length: holders.length * numberOfForms }, (_, index) => {
    const holder = holders[index % holders.length];
    const form = Math.floor(index / holders.length);
    return {
      name: `seed ${index + 1}: ${holder.path}, form ${form}.`,
      // Every run takes each object once; AOT_GENERATED=all takes all.
      isAlwaysRun: form === (index % holders.length) % numberOfForms,
      wasOnceWrong: onceWrong.includes(index + 1),
      isOnlyCompiled: true as const,
      flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : [],
      ...(notValidatedToday.includes(holder.path) && { isNeverValidated: true as const }),
      make: () => ({
        file: index % 2 === 1 ? "main.ts" : "main.mjs",
        text: generate(new Random(index + 1), index % 2 === 1, holder, form),
        files: { "tsconfig.json": tsconfig },
      }),
    };
  }),
);

const table = findBuiltinTable(bunExe());

// How the programs name the objects that no name of the language leads to.
const namesInPrograms: Record<string, string> = {
  "%Generator%.prototype": "generatorPrototype",
  "%AsyncGenerator%.prototype": "asyncGeneratorPrototype",
  "%IteratorHelper%.prototype": "helperPrototype",
};
// The global object lists its keys in one order whatever was read. An option of the engine adds Temporal. A ShadowRealm evaluates text. The rest hold one or two such members, behind an
// object that takes long to make.
const leftOut =
  /^(globalThis$|Temporal\b|ShadowRealm\.|%IntlSegment|Intl\.DurationFormat\b|WebAssembly\.(Module|Exception|Global|Memory|Table)\b)/;

test.skipIf(table === undefined)(
  "there is a program for each object of the table that adds members when they are read",
  () => {
    type Entry = { token: string; path: string; holder: string | null; isAddedAtFirstRead: boolean };
    const { entries } = JSON.parse(readFileSync(table!, "utf8")) as { entries: Entry[] };
    const pathOf = new Map(entries.map(entry => [entry.token, entry.path]));
    const inTable = new Set(
      entries.flatMap(entry => (entry.isAddedAtFirstRead && entry.holder ? [pathOf.get(entry.holder)!] : [])),
    );
    const inPrograms = new Set(holders.map(holder => holder.path));
    expect([...inTable].filter(path => !leftOut.test(path) && !inPrograms.has(namesInPrograms[path] ?? path))).toEqual(
      [],
    );
    expect(inTable.size).toBeGreaterThan(40);
  },
);
