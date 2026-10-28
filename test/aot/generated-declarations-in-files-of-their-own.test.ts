// Programs in one file that other generators of fuzz/ write, with the functions, classes, enums, constants, interfaces and types that they declare at their top laid into up to four further files
// (fuzz/declarations-in-files-of-their-own.ts): the files import from each other what they name, and in every second program a function may name what stayed behind, so that its file imports the first file of the
// program again. So are programs in which a value arrives where its type says it cannot be (generated/unsound-types.ts), two for each hole of TypeScript's type system: what lets the value through, what declares the
// type and what relies on it stand in different files. The executable prints what plain Bun prints for the same files. Every third program is built with its types erased.
import { apart } from "./fuzz/declarations-in-files-of-their-own";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";
import { filed, holes, programOfHoles } from "./generated/unsound-types";

/** Generators whose programs print the same laid out in this way as in one file. */
const sources = [
  "a-throw-at-every-call",
  "an-object-written-in-a-call-and-what-the-callee-does-with-it",
  "arrays-grown-from-empty-literals",
  "arrays-shifted-during-gc",
  "async-local-stores-entered-in-every-kind-of-job",
  "at-the-border-of-a-representation",
  "bind-spread-flatmap-and-boolean-arithmetic",
  "bodies-in-every-encoding-read-as-json",
  "chains-of-awaits-entered-by-the-host",
  "changed-while-it-is-walked",
  "changing-buffers",
  "closures-in-fields-replaced-from-outside",
  "closures-made-in-the-heads-and-bodies-of-loops",
  "closures-read-through-array-methods",
  "closures-tested-before-they-leave",
  "compiled-code-calls-text-made-at-run-time",
  "constructors-run-for-another-new-target-and-what-they-make-is-read",
  "copies-and-listings-of-a-value-that-has-more-than-its-declared-type-says",
  "counters-handed-to-the-one-call-in-a-loop",
  "definitions-that-throw-half-way-inside-a-try-and-what-their-variables-hold",
  "elements-stored-below-an-object-that-intercepts-them",
  "every-kind-of-job",
  "functions-handed-to-async-functions-and-used-around-their-awaits",
  "functions-that-keep-very-many-values-alive",
  "functions-that-make-many-objects-and-return-one",
  "functions-that-return-before-they-touch-what-the-caller-made",
  "holders-with-the-same-keys-and-one-stranger",
  "host-functions-that-throw",
  "instances-below-built-in-classes-frozen-closed-and-redefined",
  "int32-fields-read-under-keys-as-operands",
  "left-half-way",
  "list-literals-of-every-kind-of-element-returned-through-functions-and-read",
  "lists-of-numbers-through-one-map-or-filter",
  "lists-read-where-they-are-made",
  "literals-with-the-same-keys-and-values-of-other-kinds",
  "long-array-literals-of-mixed-constants",
  "long-histories-of-objects-beside-declared-types-seen-with-their-attributes",
  "loops-over-variables-of-enclosing-code",
  "loops-that-read-fields-again-behind-a-path-taken-seldom",
  "loops-whose-tests-are-settled-on-the-first-turn",
  "many-of-one-thing",
  "members-defined-under-names-out-of-a-written-list",
  "members-of-built-in-objects-handed-around",
  "members-removed-at-shared-sites-from-many-kinds-of-objects",
  "memory-of-churn",
  "names-asked-of-full-tables-and-texts-converted-again",
  "names-given-by-key-with-something-done-in-between",
  "names-lengths-and-own-keys-of-functions-however-they-are-written",
  "new-objects-kept-through-built-ins",
  "numbers-across-their-borders",
  "numbers-however-they-are-kept",
  "object-mutations",
  "objects-made-for-another-class-than-the-one-that-runs",
  "objects-read-where-they-are-made",
  "objects-that-live-for-one-turn-of-a-loop",
  "one-key-asked-in-every-way",
  "one-name-for-many-kinds-of-things",
  "one-thing-under-two-declared-types-read-stored-to-and-read-again",
  "operations-that-throw-for-what-they-are-given",
  "operators-at-the-edges",
  "order-of-promise-jobs",
  "patterns-made-at-run-time",
  "patterns-that-go-back-for-millions-of-turns",
  "patterns-with-subjects-made-from-them",
  "pieces-of-strings-carried-round-loops",
  "protocols",
  "prototype-chains-linked-by-hand",
  "read-by-the-last-holder-while-others-are-made",
  "records-with-open-members-around-rings-written-as-json",
  "several-changes-behind-a-declared-type",
  "several-changes-one-behind-the-other",
  "shapes-that-die-and-come-again",
  "short-counted-loops-with-everything-in-their-bodies",
  "sorts-with-hostile-comparators",
  "static-fields-hold-values-outside-their-declared-types",
  "strangers-where-a-type-names-a-class",
  "strings-grown-piece-by-piece-on-many-paths",
  "sums-of-fields-that-may-be-missing-and-members-stored-on-functions",
  "sums-of-whole-numbers-at-the-edges-of-what-a-double-holds",
  "super-where-the-classes-above-are-changed-later",
  "tail-calls-that-hand-rest-parameters-on",
  "text-written-into-parts-of-views",
  "this-of-functions-in-code-that-is-not-strict",
  "two-names-where-ways-meet",
  "typed-object-mutations",
  "unsound-types",
  "values-across-joins",
  "values-of-another-kind-behind-a-test",
  "values-of-another-kind-through-type-parameters",
  "values-that-end-before-a-suspension-beside-values-that-cross-it",
  "values-that-hold-themselves-written-as-json-with-counted-calls",
  "values-thrown-on-every-road-and-changed-where-they-are-caught",
  "ways-out-of-blocks-loops-and-finally",
  "what-a-built-in-calls-changes-an-object-the-program-holds",
  "what-a-callback-declares-however-it-reaches-a-built-in",
  "what-a-function-declares-however-often-call-and-apply-enter-it",
  "what-a-literal-makes-is-new-each-time",
];
const generators = await Promise.all(sources.map(async source => (await import(`./fuzz/${source}`)).generate));

const onceWrong = [30, 127, 224, 269, 321, 418, 478, 515, 550, 554];

generated(
  "declarations in files of their own",
  Array.from({ length: sources.length * 6 }, (_, index) => {
    const at = index % sources.length;
    const isErased = (index + Math.floor(index / sources.length)) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${sources[at]}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program in nine; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 9 === 0,
      isOnlyCompiled: true as const,
      // Each program is built alone and as it is written: which file holds what is what it is about.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
      make: () => apart(generators[at], new Random(index + 1)),
    };
  }),
);

const open = holes.filter(hole => !(hole in filed));

generated(
  "a value arrives where its type says it cannot be, and the declarations stand in files of their own",
  Array.from({ length: open.length * 2 }, (_, index) => {
    const hole = open[index % open.length];
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${hole}${isErased ? ", types erased" : ""}.`,
      // Every run takes one program in six; AOT_GENERATED=all takes all.
      isAlwaysRun: index % 6 === 0,
      isOnlyCompiled: true as const,
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => apart(random => programOfHoles(random, [hole]).text, new Random(index + 1)),
    };
  }),
);
