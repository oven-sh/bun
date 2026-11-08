// How a stored program is built. Built each way, it must exit and print as it does under plain Bun.
import { buildFlags } from "./flags";

export interface Way {
  name: string;
  /** Go after `--aot` in the build command. */
  flags: readonly string[];
}

export const ways: readonly Way[] = [
  { name: "as written", flags: [] },
  { name: "types erased", flags: [buildFlags.eraseTypes] },
];

// Every case of a file runs, each in every way of the file's own table.
export const runsWholeGrids = true;

export function waysFor<Row>(table: readonly Row[], _isWitness: boolean): readonly Row[] {
  return table;
}

export function partOfGrid<Case>(
  _grid: string,
  cases: readonly Case[],
  _oneIn: number,
  _nameOf: (it: Case) => string,
): readonly Case[] {
  return cases;
}
