// Which cases of a file run in front of every merge, and which on the benches behind a build alone. AOT_WHOLE=1 is a bench: every case, in every way. ./every-build.ts.
//
// THE WAYS. `bun test --aot` builds a run in one of several ways, and what a way costs has little to do with the project. One project of seven files and 1.2 KB, in seconds
// of processor time: as one program 2.7, in layers 11, with the test files from disk 21. The lowest layer holds all of Bun's own library, because what stands above it may
// ask for any of it, and from disk the world is open. A file that runs each of its cases in each way pays that for every case. So a family of cases runs in the first way
// of its table, which is the way that a user's flags take, and one witness of the family runs in all of them. Where the way itself is what a case is about (the order of
// the loader, the layers, the disk) the file goes on as it did and says so.
//
// THE GRIDS. A table of cases that a generator wrote, or that crosses one list with another, is a tool for finding faults. A fault that it found has a test of its own. In
// front of a merge one case in so many runs, another part each day, as ../run-parallel.ts draws its builds.
import { runsWhole } from "./every-build";

export const runsWholeGrids = runsWhole;
const today = Number(process.env.AOT_DAY) || Math.floor(Date.now() / 86_400_000);

/**
 * `ways`: the table of the file, the way of a user's flags first. `isWitness`: whether this case runs in all of them.
 * THE WITNESS IS THE CASE THAT FAILED IN THAT WAY. Run the file as it was and as it is to be on the build right in front of the cure: the case that is red there, in the way in
 * which it is red, is the witness. The first case of a table often is not: taken blindly it lost what three files of seven had been written for. So there is no default.
 */
export function waysFor<Way>(ways: readonly Way[], isWitness: boolean, whole = runsWholeGrids): readonly Way[] {
  if (typeof isWitness !== "boolean")
    throw new TypeError(
      "waysFor(ways, isWitness): say which case is the witness: the one that failed in the dear way on the build in front of the cure",
    );
  return whole || isWitness ? ways : ways.slice(0, 1);
}

const said = new Set<string>();
/**
 * One case in `oneIn`, by the name of the case and the day, so that `oneIn` days cover the grid. `grid` names it in the line on stderr that says which part this is:
 * AOT_DAY=<that day> takes the same part again.
 */
export function partOfGrid<Case>(
  grid: string,
  cases: readonly Case[],
  oneIn: number,
  nameOf: (it: Case) => string,
  day = today,
  whole = runsWholeGrids,
): readonly Case[] {
  if (whole || oneIn <= 1) return cases;
  const part = cases.filter(it => (Bun.hash.crc32(nameOf(it)) + day) % oneIn === 0);
  if (!said.has(grid))
    console.error(
      `DAY ${day}: ${grid}: ${part.length} of ${cases.length} cases. AOT_DAY=${day} takes the same, AOT_WHOLE=1 all.`,
    );
  said.add(grid);
  return part;
}
