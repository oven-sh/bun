// Which part of a large set of cases a run takes. For the test files that still draw a part: none is added, and this file goes with the last of them.
import { bunEnv, isASAN, isDebug } from "harness";

/** What a draw goes by: the revision in AOT_SHARE, which CI pins, or else the commit of the Bun under test. Each lane of CI adds a number of its own, `<revision>+<number>`. */
export const sampleRevision = /^[0-9a-f]{4}/.test(process.env.AOT_SHARE ?? "") ? process.env.AOT_SHARE! : Bun.revision;
/** Of what is dealt out one in n, this run takes the share `shareNumber % n`. */
export const shareNumber = Number(sampleRevision.split("+")[1]) || 0;
export const freshSeed: number | undefined =
  Number(process.env.AOT_FRESH_SEED) ||
  (process.env.AOT_FRESH_SEEDS === "1" || process.env.AOT_TAKES === "drawn"
    ? Math.floor(Date.now() / 86_400_000) * 100_000 + (parseInt(sampleRevision.slice(0, 4), 16) || 0) + shareNumber
    : undefined);

// A debug or ASAN build of Bun is many times slower, so it runs the quick subset unless told otherwise.
export const wanted = process.env.AOT_PROGRAMS ?? (isASAN || isDebug ? "quick" : "");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

// CI has four cores for five minutes a file, and every program in every way would take it a day for each commit. So a run that is told nothing takes a share of the programs, and which
// share follows from the revision of the Bun under test: each commit takes others, and in time all are taken. A test is named after its program, so AOT_PROGRAMS=<name> runs a red again.
const spelledShare = process.env.AOT_SHARE ?? Bun.revision;
const seedOfShare = spelledShare.split("+")[0];
export const isToldWhatToTake = seedOfShare === "all" || process.env.AOT_PROGRAMS !== undefined || updates;
// Most helpers have a rule of their own for the quick subset. One that has none passes `alsoOfQuickSubset`, or a debug or ASAN build would take everything.
const takesEverything = (alsoOfQuickSubset: boolean) => isToldWhatToTake || (wanted === "quick" && !alsoOfQuickSubset);
let hasSaidShare = false;
// CI has two steps for these tests. One may hold up a merge, so it is the same on every commit: AOT_TAKES=fixed takes no share at all, only what every run takes. The other shows what
// the shares find and holds up nothing: AOT_TAKES=drawn takes the shares alone, AOT_TAKES=both takes both. A run that is told nothing takes what is fixed.
const takes = process.env.AOT_TAKES ?? "fixed";
/** Whether this run takes what every run takes: the programs of a list, what once went wrong. */
export const takesWhatIsFixed = takes !== "drawn";
/** Whether this run takes what is drawn: a share, a sample. */
export const takesWhatIsDrawn = takes !== "fixed";

/** For a tool that takes every n-th program, starting at the i-th, as `<i>/<n>`: part `part` of `parts`, or, in a run that takes a share, one of `oneIn` pieces of that part. */
export function partInShare(part: number, parts: number, oneIn: number, alsoOfQuickSubset = false): string {
  if (takesEverything(alsoOfQuickSubset)) return `${part}/${parts}`;
  return `${part + parts * Number((BigInt(Bun.hash(seedOfShare)) + BigInt(shareNumber)) % BigInt(oneIn))}/${parts * oneIn}`;
}

function sayShare() {
  if (!hasSaidShare)
    console.error(
      `SHARE: this run takes a part of the programs. AOT_SHARE=${spelledShare} takes the same part, AOT_SHARE=all takes all of them`,
    );
  hasSaidShare = true;
}

/** Whether this run takes the program, the case or the pair `name`, of whose kind a run takes one in `oneIn`. */
export function inShare(name: string, oneIn: number, alsoOfQuickSubset = false): boolean {
  if (takes === "fixed") return false;
  if (takesEverything(alsoOfQuickSubset)) return true;
  sayShare();
  return (
    BigInt(Bun.hash(seedOfShare + " " + name.replaceAll("\\", "/"))) % BigInt(oneIn) === BigInt(shareNumber % oneIn)
  );
}

/** The `count` of `items` that this run takes, by their names, so that what a run costs does not hang on the draw. All of them where the run is told what to take. */
export function takeFromShare<T>(items: T[], count: number, nameOf: (item: T) => string): T[] {
  if (takes === "fixed") return [];
  if (isToldWhatToTake || items.length <= count) return items;
  sayShare();
  const rankOf = new Map(items.map(item => [item, Bun.hash(seedOfShare + " " + nameOf(item).replaceAll("\\", "/"))]));
  const ranked = items.toSorted((a, b) => (rankOf.get(a)! < rankOf.get(b)! ? -1 : 1));
  const first = (shareNumber * count) % items.length;
  const drawn = new Set([...ranked, ...ranked].slice(first, first + count));
  return items.filter(item => drawn.has(item));
}

/** For what no run is meant to take whole: one in `oneIn` by the commit, so that in time all are taken, and nothing where the run is told what to take. */
export const inShareOfTheRest = (name: string, oneIn: number) => !isToldWhatToTake && inShare(name, oneIn, true);

/** For what takes one in `oneIn` of a list, as a debug or ASAN build of Bun takes a tenth of many: whether it takes `name`, the `index`-th. By the commit, as every share, so that in time all are taken; every `oneIn`-th where the run is told what to take. */
export const inShareOfList = (name: string, index: number, oneIn = 10) =>
  isToldWhatToTake ? index % oneIn === 0 : inShare(name, oneIn, true);

/** What plain Bun is started with. The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing. */
export const referenceEnv = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };
