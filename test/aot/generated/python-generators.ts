// The generators under python/ write random programs: `python3 <generator>.py <seed>` prints one, and the same seed always prints the
// same program. The top of each generator says what its programs are about. This is the list of them.
import { spawnSync } from "bun";
import { join } from "path";

export type Options = {
  /** What the generator is called with, by default the seed alone. */
  words?: (seed: number) => (string | number)[];
  /** For a generator that has no seeds, or whose number means something else. */
  seeds?: number[];
  /** "As plain Bun or a throw", says the top of the generator. */
  linesMayBeRefused?: true;
  plainEnv?: Record<string, string>;
  /** Seeds whose programs cannot be judged: TypeScript or plain Bun rejects them, they run for a minute, or they put a value where its type does not allow it. */
  leftOut?: number[];
  /** TODO: how its programs depart today: those of the seeds named, or all. */
  failsToday?: Record<number, string> | string;
  /** By seed: how `bun run --aot` departs from the executable today. */
  modeFailsToday?: Record<number, string>;
};

// The regular expression JIT of plain Bun and the ahead-of-time compiler share the code generator.
const withoutTheRegExpJIT = { plainEnv: { BUN_JSC_useRegExpJIT: "0" } };
const orThrows = { linesMayBeRefused: true } as const;
const once = { seeds: [1] };
const as = (language: string) => ({ words: (seed: number) => [seed, language] });
const W = "an instance of a class that typed code hands to JavaScript and keeps is held to its layout";

export const generators: [name: string, extension: "ts" | "js", options?: Options][] = [
  ["altered-arrays", "js", { ...orThrows, ...as("js") }],
  ["altered-arrays", "ts", { ...orThrows, ...as("ts") }],
  ["arrays-altered-where-they-are-made", "ts", { ...orThrows, seeds: [0, 1, 2, 3, 4, 5, 6, 7] }],
  ["async-generators", "ts"],
  ["async-generators-and-the-order-of-jobs", "ts"],
  ["bodies-of-for-in-loops", "js"],
  ["calls-by-value", "ts"],
  ["class-members-asked-in-every-order", "js", { ...orThrows, ...as("js") }],
  ["class-members-asked-in-every-order", "ts", { ...orThrows, ...as("ts") }],
  ["closures-handed-to-array-methods", "js", as("js")],
  ["closures-handed-to-array-methods", "ts", as("ts")],
  ["constants-made-at-first-read", "ts"],
  ["constructor-functions-that-stay-inside", "js", once],
  ["control-flow", "ts"],
  ["deep-equality-by-the-host", "ts"],
  ["doors-by-which-plain-data-comes-to-a-class", "ts", { seeds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112] }],
  ["element-reads-and-stores", "ts"],
  ["families-of-classes", "ts", orThrows],
  ["for-in-loops", "ts"],
  ["inherited-setters", "js"],
  ["json-stringify-of-typed-values", "ts"],
  ["keys-made-of-parts", "ts"],
  ["keys-that-die", "ts"],
  ["keys-that-look-like-numbers", "ts"],
  ["literals-let-out-through-places-that-say-nothing", "ts"],
  ["many-shapes-and-many-names", "js", { seeds: [200, 400, 600, 1000, 3000] }],
  ["maps-and-sets", "ts"],
  ["maps-and-sets-changed-while-iterated", "ts"],
  ["members-that-are-nearly-always-whole-numbers", "ts"],
  ["members-that-hold-references", "ts", { leftOut: [4, 10, 18] }],
  ["numbers-that-may-be-integers", "ts", { leftOut: [8] }],
  ["objects", "ts", { leftOut: [20, 27] }],
  ["objects-side-by-side-that-take-the-same-steps", "ts"],
  ["objects-that-stay-inside", "js"],
  ["objects-that-stay-inside-with-names-of-their-own", "js"],
  ["old-objects-side-by-side-get-young-values", "ts"],
  ["old-typed-objects-get-young-extras", "ts"],
  ["one-object-seen-two-ways", "ts"],
  ["one-property-written-in-two-ways", "js"],
  ["order-of-asynchronous-code", "ts"],
  ["order-of-microtasks", "ts"],
  ["own-properties-asked-by-name", "js"],
  ["references-in-every-kind-of-place", "ts"],
  ["regular-expression-literals", "js", { ...withoutTheRegExpJIT, leftOut: [1, 8, 26] }],
  ["regular-expressions-and-near-matches", "js", withoutTheRegExpJIT],
  ["rest-parameters", "ts", { ...orThrows, leftOut: [8, 10, 15, 22] }],
  ["roads-to-a-call-site", "js"],
  ["roads-to-a-read-site", "js", { words: seed => ["js", seed] }],
  ["shapes-that-die-and-come-back", "js"],
  ["sloppy-code", "js"],
  ["spreads-held-as-records", "ts", { leftOut: [8, 17, 30] }],
  ["spreads-of-every-kind-of-storage", "ts", orThrows],
  ["stores-by-name-into-every-kind-of-object", "js", once],
  ["stores-by-text-made-at-run-time", "js"],
  ["strings", "ts"],
  ["strings-compared-with-literals", "ts"],
  ["switch-statements", "ts"],
  ["tail-calls", "ts", { modeFailsToday: { 2: "the first frame of a chain of checked tail calls stays", 4: "the first frame of a chain of checked tail calls stays" } }],
  ["tail-calls-that-permute-their-arguments", "ts"],
  ["the-async-context", "ts"],
  ["typed-objects-through-built-ins-and-back", "ts", { seeds: [5, 42, 79, 116, 153, 190, 227, 264, 301, 338, 375, 412, 449, 486, 523, 560, 597, 634, 671, 708, 745, 782, 819] }],
  ["types-that-need-not-end", "ts", orThrows],
  ["unions-of-string-literals", "ts", orThrows],
  ["values-at-the-edge-of-the-type-of-a-field", "ts", { seeds: [3, 74, 145, 216, 287, 358, 429, 500, 571, 642, 713, 784, 855, 926, 997, 1068, 1139, 1210, 1281, 1352, 1423, 1494, 1565] }],
  ["values-that-fit-their-type", "ts", { seeds: [16, 244, 261, 266, 282, 347, 678, 1009, 1325, 1620, 1946, 2277, 2475, 2631, 2632, 2688, 2765, 2926, 4855, 5186, 5513] }],
  ["ways-out-of-a-statement", "js", as("js")],
  ["ways-out-of-a-statement", "ts", as("ts")],
  ["ways-to-make-a-value-that-fits-its-type", "ts", { seeds: [5, 72, 139, 206, 273, 340, 407, 474, 541, 608, 675, 742, 809, 876, 943, 1010, 1077, 1144, 1211, 1278, 1345, 1412, 1479, 1546, 1613] }],
  ["what-a-function-has-stored-there-itself", "ts", once],
  ["what-is-thrown-and-who-catches-it", "ts", { leftOut: [1, 10, 15, 23, 27] }],
  ["what-javascript-does-to-an-object-it-was-handed", "ts", { seeds: [0, 2, 3, 4, 10, 23, 24, 25, 26, 27, 28, 33, 46, 48, 49, 50, 54, 56, 63, 69, 71, 72, 73, 77, 79, 86, 91, 92, 93, 99, 114, 115, 116, 122, 137, 138, 139, 145, 161, 168, 183, 184, 185, 191, 206, 207, 208, 214, 230, 253, 276, 299, 322, 341, 342, 343, 345, 349, 364, 365, 366, 368, 372, 391, 414, 437, 456, 457, 458, 460, 464, 478, 479, 480, 481, 482, 483, 487, 502, 503, 504, 506, 508, 510, 517, 525, 526, 527, 529, 531, 533, 540, 545, 546, 547, 552, 553, 568, 569, 570, 575, 576, 591, 592, 593, 598, 599, 621, 622, 637, 638, 639, 644, 645, 660, 661, 662, 667, 668], failsToday: { 502: W, 503: W, 504: W, 508: W, 510: W, 517: W, 525: W, 526: W, 527: W, 531: W, 533: W, 540: W } }],
  ["what-stands-for-undefined-among-numbers", "ts", orThrows],
  ["what-the-host-sees", "ts"],
];

export const python = Bun.which("python3");

export function program(name: string, extension: string, options: Options, seed: number): { file: string; text: string; files?: Record<string, string> } {
  const words = options.words?.(seed) ?? [seed];
  const { exitCode, stdout, stderr } = spawnSync({ cmd: [python!, "-B", join(import.meta.dir, "python", `${name}.py`), ...words.map(String)], stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`${name}.py: ${stderr}`);
  const [text, ...others] = stdout.toString().split("\n//// ");
  const files = Object.fromEntries(others.map(other => [other.slice(0, other.indexOf("\n")), other.slice(other.indexOf("\n") + 1) + "\n"]));
  return { file: `main.${extension}`, text: others.length ? text + "\n" : text, files };
}

/** Two generators of one name differ in the language they write. */
export const headingOf = (name: string, extension: string) => (generators.filter(other => other[0] === name).length > 1 ? `${name} in ${extension}` : name);
