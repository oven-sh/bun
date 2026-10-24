// The generators under python/ write random programs: `python3 <generator>.py <seed>` prints one, and the same seed always prints the
// same program. The top of each generator says what its programs are about. This is the list of them.
import { spawnSync } from "bun";
import { join } from "path";

export type Options = {
  /** What the generator is called with, by default the seed alone. */
  words?: (seed: number) => (string | number)[];
  /** For a generator that has no seeds, or whose number means something else. */
  seeds?: number[];
  plainEnv?: Record<string, string>;
  /** Seeds whose programs cannot be judged: TypeScript or plain Bun rejects them, they run for a minute, or they put a value where its type does not allow it. */
  leftOut?: number[];
  /** TODO: how its programs depart today: those of the seeds named, or all. */
  failsToday?: Record<number, string> | string;
  /** By seed: how `bun run --aot` departs from the executable today. */
  modeFailsToday?: Record<number, string>;
  /** Seeds with which generated-fresh-seeds found a bug that is fixed. They always run. */
  foundByFreshSeeds?: number[];
  /** Why generated-fresh-seeds does not give it seeds that nobody has looked at. */
  noFreshSeeds?: string;
};

// The regular expression JIT of plain Bun and the ahead-of-time compiler share the code generator.
const withoutTheRegExpJIT = { plainEnv: { BUN_JSC_useRegExpJIT: "0" } };
const once = { seeds: [1] };
const as = (language: string) => ({ words: (seed: number) => [seed, language] });
const W = "an instance of a class that typed code hands to JavaScript and keeps is held to its layout";
const X = "a value from external data that does not match an inferred type throws a TypeError in some uses";
const upTo = (count: number) => Array.from({ length: count }, (_, i) => i);

export const generators: [name: string, extension: "ts" | "js", options?: Options][] = [
  ["altered-arrays", "js", { ...as("js") }],
  ["altered-arrays", "ts", { ...as("ts") }],
  ["arrays-mutated-near-allocation", "ts", { seeds: [0, 1, 2, 3, 4, 5, 6, 7] }],
  ["async-generators", "ts"],
  ["async-generator-job-order", "ts"],
  ["async-generator-pipelines", "ts"],
  ["async-generator-steps-by-hand", "ts"],
  ["for-in-loop-bodies", "js"],
  ["calls-by-value", "ts"],
  ["class-members-any-lookup-order", "js", { ...as("js") }],
  ["class-members-any-lookup-order", "ts", { ...as("ts") }],
  ["closures-passed-to-array-methods", "js", as("js")],
  ["closures-passed-to-array-methods", "ts", as("ts")],
  ["lazy-constants", "ts"],
  ["unescaped-constructor-functions", "js", once],
  ["control-flow", "ts"],
  ["host-deep-equality", "ts"],
  ["external-data-into-classes", "ts", { seeds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112] }],
  ["element-reads-and-stores", "ts"],
  ["class-families", "ts"],
  ["for-in-loops", "ts"],
  ["inherited-setters", "js"],
  ["instances-not-made-by-their-class", "js", { ...as("js"), seeds: upTo(86), noFreshSeeds: "the seed picks one of 86 programs" }],
  ["instances-not-made-by-their-class", "ts", { ...as("ts"), seeds: upTo(86), noFreshSeeds: "the seed picks one of 86 programs" }],
  ["json-stringify-typed-values", "ts"],
  ["concatenated-keys", "ts"],
  ["appended-strings", "ts"],
  ["long-concatenation-chains", "ts", { seeds: [3000, 20000] }],
  ["collected-keys", "ts"],
  ["numeric-looking-keys", "ts"],
  ["literals-escape-through-untyped-slots", "ts"],
  ["many-structures-many-names", "js", { seeds: [200, 400, 600, 1000, 3000] }],
  ["maps-and-sets", "ts"],
  ["external-data-in-containers", "ts", { seeds: upTo(60), failsToday: Object.fromEntries([20, 21, 22, 23, 38, 39, 44, 45, 46, 47, 52, 53, 54, 55, 58, 59].map(seed => [seed, X])) }],
  // 94 to 97 write a cast or an annotation that the value does not satisfy, and written types are checked.
  ["external-data-in-inferred-places", "ts", { seeds: upTo(146), leftOut: [94, 95, 96, 97], failsToday: Object.fromEntries([70, 71, 72, 73, 74, 75, 88, 89, 98, 99, 120, 121, 138, 139, 140, 141].map(seed => [seed, X])) }],
  ["optional-number-and-boolean-fields", "ts", { seeds: upTo(9) }],
  // Left out: three sources write `x!`, two a cast that converts, one throws while it loads.
  [
    "values-wider-than-their-types",
    "ts",
    {
      seeds: upTo(391),
      leftOut: [45, 54, 55, 273, 284, 387],
      modeFailsToday: Object.fromEntries([10, 25, 34, 35, 40, 41, 42, 44, 291, 314, 337, 349, 350, 351, 377, 388].map(seed => [seed, "the executable throws and bun run --aot goes on as plain Bun does"])),
    },
  ],
  // CET and WET are time zones of some ICU data only.
  ["intl-constant-arguments", "ts", { seeds: upTo(121), leftOut: [50, 51] }],
  ["collections-mutated-during-iteration", "ts"],
  ["mostly-integer-members", "ts"],
  ["reference-holding-members", "ts", { leftOut: [4, 10, 18] }],
  ["maybe-integer-numbers", "ts", { leftOut: [8] }],
  ["objects", "ts", { leftOut: [20, 27], noFreshSeeds: "some of its programs store an object through `any` into a setter whose parameter is a number" }],
  ["adjacent-objects-same-transitions", "ts"],
  ["non-escaping-objects", "js"],
  ["unescaped-objects-with-own-names", "js"],
  ["adjacent-old-objects-get-young-values", "ts"],
  ["old-typed-objects-get-young-extras", "ts"],
  ["one-object-two-types", "ts"],
  ["one-property-two-spellings", "js"],
  ["async-code-order", "ts"],
  ["microtask-order", "ts"],
  ["own-property-queries-by-name", "js"],
  ["references-in-every-slot-kind", "ts"],
  ["regular-expression-literals", "js", { ...withoutTheRegExpJIT, leftOut: [1, 8, 26] }],
  ["regexps-and-near-matches", "js", withoutTheRegExpJIT],
  ["repeated-groups-that-can-match-nothing", "js", withoutTheRegExpJIT],
  ["rest-parameters", "ts", { leftOut: [8, 10, 15, 22] }],
  ["paths-to-call-site", "js"],
  ["paths-to-read-site", "js", { words: seed => ["js", seed] }],
  ["structures-die-and-return", "js"],
  ["sloppy-code", "js"],
  ["spreads-as-records", "ts", { leftOut: [8, 17, 30] }],
  ["spreads-every-indexing-type", "ts"],
  ["named-stores-every-object-kind", "js", once],
  ["stores-from-runtime-code", "js"],
  ["strings", "ts"],
  ["strings-compared-with-literals", "ts"],
  ["switch-statements", "ts"],
  ["tail-calls", "ts", { modeFailsToday: { 2: "the first frame of a chain of checked tail calls stays", 4: "the first frame of a chain of checked tail calls stays" } }],
  ["tail-calls-permuting-arguments", "ts"],
  ["async-context", "ts"],
  ["typed-objects-through-builtins", "ts", { seeds: [5, 42, 79, 116, 153, 190, 227, 264, 301, 338, 375, 412, 449, 486, 523, 560, 597, 634, 671, 708, 745, 782, 819] }],
  ["infinite-types", "ts"],
  ["unions-of-look-alike-classes", "ts"],
  ["unions-of-string-literals", "ts"],
  ["field-type-boundary-values", "ts", { seeds: [3, 74, 145, 216, 287, 358, 429, 500, 571, 642, 713, 784, 855, 926, 997, 1068, 1139, 1210, 1281, 1352, 1423, 1494, 1565] }],
  ["well-typed-values", "ts", { seeds: [16, 244, 261, 266, 282, 347, 678, 1009, 1325, 1620, 1946, 2277, 2475, 2631, 2632, 2688, 2765, 2926, 4855, 5186, 5513] }],
  ["statement-exits", "js", as("js")],
  ["statement-exits", "ts", as("ts")],
  ["well-typed-value-constructions", "ts", { seeds: [5, 72, 139, 206, 273, 340, 407, 474, 541, 608, 675, 742, 809, 876, 943, 1010, 1077, 1144, 1211, 1278, 1345, 1412, 1479, 1546, 1613] }],
  ["well-typed-values-of-generic-types", "ts", { seeds: [46, 51, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 50, 52, 53, 54] }],
  ["well-typed-values-of-unusual-types", "ts", { seeds: [25, 8, 0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99] }],
  ["function-own-stores", "ts", once],
  ["typed-fields-widened-then-compared", "ts", once],
  ["throw-and-catch-pairs", "ts", { leftOut: [1, 10, 15, 23, 27] }],
  ["js-mutates-typed-objects", "ts", { seeds: [0, 2, 3, 4, 10, 23, 24, 25, 26, 27, 28, 33, 46, 48, 49, 50, 54, 56, 63, 69, 71, 72, 73, 77, 79, 86, 91, 92, 93, 99, 114, 115, 116, 122, 137, 138, 139, 145, 161, 168, 183, 184, 185, 191, 206, 207, 208, 214, 230, 253, 276, 299, 322, 341, 342, 343, 345, 349, 364, 365, 366, 368, 372, 391, 414, 437, 456, 457, 458, 460, 464, 478, 479, 480, 481, 482, 483, 487, 502, 503, 504, 506, 508, 510, 517, 525, 526, 527, 529, 531, 533, 540, 545, 546, 547, 552, 553, 568, 569, 570, 575, 576, 591, 592, 593, 598, 599, 621, 622, 637, 638, 639, 644, 645, 660, 661, 662, 667, 668], failsToday: { 502: W, 503: W, 504: W, 508: W, 510: W, 517: W, 525: W, 526: W, 527: W, 531: W, 533: W, 540: W } }],
  ["undefined-sentinel-among-numbers", "ts"],
  ["host-visible-values", "ts"],
  ["typed-programs", "ts"],
  ["typed-programs-with-holes", "ts"],
  ["exception-paths", "ts"],
  ["typed-programs-in-workers", "ts"],
  ["resource-management", "ts"],
  ["untyped-border", "ts", { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60], failsToday: Object.fromEntries([5, 6, 8, 12, 14, 15, 17, 18, 19, 20, 22, 27, 28, 29, 34, 35, 36, 37, 40, 46, 48, 49, 52, 55, 56, 58, 59, 60].map(seed => [seed, "a value from untyped code is refused at the border, until values are checked at the edge"])), noFreshSeeds: "a value from untyped code is refused at the border, until values are checked at the edge" }],
  ["untyped-border-misfits", "ts", { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], failsToday: "a value from untyped code is refused at the border, until values are checked at the edge", noFreshSeeds: "a value from untyped code is refused at the border, until values are checked at the edge" }],
];

export const python = Bun.which("python3");

export function program(name: string, extension: string, options: Options, seed: number): { file: string; text: string; files?: Record<string, string> } {
  const words = options.words?.(seed) ?? [seed];
  const { exitCode, stdout, stderr } = spawnSync({ cmd: [python!, "-B", join(import.meta.dir, "python", `${name}.py`), ...words.map(String)], env: { ...process.env, PYTHONUTF8: "1" }, stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`${name}.py: ${stderr}`);
  const [text, ...others] = stdout.toString().replaceAll("\r\n", "\n").split("\n//// ");
  const files = Object.fromEntries(others.map(other => [other.slice(0, other.indexOf("\n")), other.slice(other.indexOf("\n") + 1) + "\n"]));
  return { file: `main.${extension}`, text: others.length ? text + "\n" : text, files };
}

/** Two generators of one name differ in the language they write. */
export const headingOf = (name: string, extension: string) => (generators.filter(other => other[0] === name).length > 1 ? `${name} in ${extension}` : name);
