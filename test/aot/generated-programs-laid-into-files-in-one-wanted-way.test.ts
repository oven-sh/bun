// Programs in one file that other generators of fuzz/ write, laid into several files (fuzz/programs-laid-into-files-in-one-wanted-way.ts) so that TypeScript imports TypeScript that imports JavaScript and the other way
// round, with one thing true of the files of each program: J some are JavaScript that nothing declares, so that what they export is inferred; D some are JavaScript beside declaration files that say too little: `1`
// for a number, a number for `unknown`, one member of a union; N the declaration files are not valid either, and the program's tsconfig.json says skipLibCheck; B the first file imports through a barrel; P some of the
// JavaScript with its declarations lies in node_modules as packages, ES modules and CommonJS; T a file in TypeScript says too little in its own annotations and begins with `// @ts-nocheck`. The files that import
// believe what is declared. The executable prints what plain Bun prints for the same files. Every fourth program is built with its types erased.
import { laidOut, type Way } from "./fuzz/programs-laid-into-files-in-one-wanted-way";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const letters: Record<string, Way> = {
  J: "JavaScript that nothing declares",
  D: "JavaScript beside declarations that say too little",
  N: "JavaScript beside declarations that are not valid",
  B: "a barrel",
  P: "packages",
  T: "TypeScript whose own annotations say too little",
};

/** The generators whose programs are typed, each with the ways in which one of its first forty programs can be laid out so that TypeScript accepts all files. */
const sources: Record<string, string> = {
  "a-throw-at-every-call": "JDNBT",
  "arrays-grown-from-empty-literals": "JDNBPT",
  "arrays-shifted-during-gc": "JDNPT",
  "at-the-border-of-a-representation": "JDNBPT",
  "bind-spread-flatmap-and-boolean-arithmetic": "JNBPT",
  "bodies-in-every-encoding-read-as-json": "JDNBT",
  "changed-while-it-is-walked": "JDNBT",
  "changing-buffers": "JDNBPT",
  "closures-in-fields-replaced-from-outside": "JBT",
  "closures-read-through-array-methods": "JDBT",
  "constructors-run-for-another-new-target-and-what-they-make-is-read": "JDNBPT",
  "copies-and-listings-of-a-value-that-has-more-than-its-declared-type-says": "JB",
  "counters-handed-to-the-one-call-in-a-loop": "DNBT",
  "definitions-that-throw-half-way-inside-a-try-and-what-their-variables-hold": "NBT",
  "every-kind-of-job": "JDNB",
  "functions-that-keep-very-many-values-alive": "J",
  "functions-that-make-many-objects-and-return-one": "JB",
  "holders-with-the-same-keys-and-one-stranger": "JDNBPT",
  "host-functions-that-throw": "JDNBPT",
  "instances-below-built-in-classes-frozen-closed-and-redefined": "NBPT",
  "left-half-way": "JDBT",
  "list-literals-of-every-kind-of-element-returned-through-functions-and-read": "JDNBPT",
  "lists-of-numbers-through-one-map-or-filter": "JDNBPT",
  "lists-read-where-they-are-made": "JDNBPT",
  "literals-with-the-same-keys-and-values-of-other-kinds": "J",
  "long-histories-of-objects-beside-declared-types-seen-with-their-attributes": "JDBT",
  "loops-over-variables-of-enclosing-code": "JDNBPT",
  "loops-whose-tests-are-settled-on-the-first-turn": "JDBT",
  "members-of-built-in-objects-handed-around": "JDNBT",
  "memory-of-churn": "JDNBPT",
  "names-asked-of-full-tables-and-texts-converted-again": "NBP",
  "names-given-by-key-with-something-done-in-between": "JDBT",
  "new-objects-kept-through-built-ins": "NBP",
  "numbers-across-their-borders": "JDNBPT",
  "numbers-however-they-are-kept": "JDNBPT",
  "objects-made-for-another-class-than-the-one-that-runs": "JB",
  "objects-read-where-they-are-made": "JNBT",
  "objects-that-live-for-one-turn-of-a-loop": "BT",
  "one-key-asked-in-every-way": "B",
  "one-name-for-many-kinds-of-things": "JDB",
  "one-thing-under-two-declared-types-read-stored-to-and-read-again": "JB",
  "operations-that-throw-for-what-they-are-given": "JNBPT",
  "operators-at-the-edges": "JDNBT",
  "order-of-promise-jobs": "BT",
  "patterns-made-at-run-time": "JDNBPT",
  "patterns-that-go-back-for-millions-of-turns": "JDBPT",
  "patterns-with-subjects-made-from-them": "JDNBT",
  "pieces-of-strings-carried-round-loops": "JNT",
  "prototype-chains-linked-by-hand": "JDT",
  "read-by-the-last-holder-while-others-are-made": "JDNBPT",
  "records-with-open-members-around-rings-written-as-json": "JNP",
  "several-changes-behind-a-declared-type": "DNBPT",
  "sorts-with-hostile-comparators": "JDBPT",
  "static-fields-hold-values-outside-their-declared-types": "JNBPT",
  "strangers-where-a-type-names-a-class": "JDNBPT",
  "tail-calls-that-hand-rest-parameters-on": "JBT",
  "text-written-into-parts-of-views": "JDNBT",
  "two-names-where-ways-meet": "JDNBT",
  "typed-object-mutations": "JDNBPT",
  "unsound-types": "JDNBT",
  "values-across-joins": "JDNBT",
  "values-of-another-kind-behind-a-test": "JDNBPT",
  "values-of-another-kind-through-type-parameters": "JN",
  "values-that-hold-themselves-written-as-json-with-counted-calls": "N",
  "values-thrown-on-every-road-and-changed-where-they-are-caught": "B",
};
const wanted = Object.entries(sources).flatMap(([source, its]) =>
  Array.from(its, letter => ({ source, way: letters[letter] })),
);
const generators = Object.fromEntries(
  await Promise.all(Object.keys(sources).map(async source => [source, (await import(`./fuzz/${source}`)).generate])),
);

generated(
  "programs laid into files in one wanted way",
  wanted.map(({ source, way }, index) => {
    const isErased = index % 4 === 3;
    return {
      name: `${source}, ${way}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program in seven; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 7 === 0,
      isOnlyCompiled: true as const,
      // Each program is built alone and as it is written: which file holds what, and what is said about it, is what it is about.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      // What is declared says less than what is there, so TypeScript may reject a file that imports it. Then there is nothing to compare.
      mayBeUnjudgeable: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      // The seed comes of the name, so that a line more or less in the table above moves no other program.
      make: () => laidOut(generators[source], way, new Random(Bun.hash.crc32(`${source}, ${way}`))),
    };
  }),
);
