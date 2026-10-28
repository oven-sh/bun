// Files of cases. Every line of such a file that starts with `t("<name>"` or `await t("<name>"` is one case, and the lines ahead of them serve all of them. The name of a case is its value on each axis of the table, separated by spaces.
// A case is compiled beside the other cases of its file, and alone: the whole-program analysis of --aot proves more about a small program, and other things about a large one.
//
//   bun test test/aot/generated-table                            every table: each file as one program, and a sample of its cases alone
//   AOT_GENERATED_ALONE=1000 bun test test/aot/generated-table   so many cases of each table alone, in place of the number that its test names
//   AOT_GENERATED=all bun test test/aot/generated-table          every case alone
//   AOT_GENERATED="in one program" bun test ..                   no case alone
import { mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";
import type { Generated } from "./run-generated";

export interface CaseFile {
  name: string;
  head: string;
  cases: { name: string; line: string }[];
  /** Lines behind the cases. */
  tail?: string;
}

export const textOf = ({ head, cases, tail = "" }: CaseFile, isKept: (name: string) => boolean = () => true) =>
  head +
  cases
    .filter(({ name }) => isKept(name))
    .map(({ line }) => line)
    .join("\n") +
  "\n" +
  tail;

/** So many of the names that every value of every axis, and then every pair of values, occurs as often as any other. The same names give the same choice. */
export function spread(names: string[], count: number): string[] {
  const values = names.map(name => name.split(" "));
  const axes = Math.max(0, ...values.map(words => words.length));
  const numbers = new Map<string, number>();
  const numberOf = (key: string) => numbers.get(key) ?? (numbers.set(key, numbers.size), numbers.size - 1);
  const sizes = Array.from({ length: axes }, (_, axis) => new Set(values.map(words => words[axis])).size);
  const counted = values.map(words => {
    const keys: number[] = [];
    const weights: number[] = [];
    for (let a = 0; a < axes; a++) {
      keys.push(numberOf(`${a} ${words[a]}`));
      weights.push(sizes[a] * names.length);
      for (let b = a + 1; b < axes; b++) {
        keys.push(numberOf(`${a} ${words[a]} ${b} ${words[b]}`));
        weights.push(sizes[a] * sizes[b]);
      }
    }
    return { keys, weights };
  });
  const seen = new Float64Array(numbers.size);
  const isChosen = new Uint8Array(names.length);
  const chosen: number[] = [];
  while (chosen.length < Math.min(count, names.length)) {
    let best = -1;
    let least = Infinity;
    for (let i = 0; i < names.length; i++) {
      if (isChosen[i]) continue;
      const { keys, weights } = counted[i];
      let cost = 0;
      for (let k = 0; k < keys.length; k++) cost += seen[keys[k]] * weights[k];
      if (cost < least) [best, least] = [i, cost];
    }
    isChosen[best] = 1;
    chosen.push(best);
    for (const key of counted[best].keys) seen[key]++;
  }
  return chosen.sort((a, b) => a - b).map(i => names[i]);
}

export interface Expectations {
  /** How many cases are compiled alone in every run of the test. */
  alone: number;
  /** The cases that depart from plain Bun today, and how. They are listed as todos and left out of the programs. */
  failsToday?: { cases: RegExp; how: string }[];
  /** The cases that leave an error that nobody catches. */
  leaveAnError?: RegExp;
}

/** Each file as one program, and each case as a program of its own. */
export function programsOf(files: CaseFile[], { alone, failsToday = [], leaveAnError }: Expectations): Generated[] {
  const failure = (name: string) => failsToday.find(({ cases }) => cases.test(name))?.how;
  const names = files.flatMap(file => file.cases.map(({ name }) => name));
  const alwaysAlone = new Set(spread(names, Number(process.env.AOT_GENERATED_ALONE ?? alone)));
  const common = { isOnlyCompiled: true as const };
  const error = (names: string[]) => (names.some(name => leaveAnError?.test(name)) ? { leavesAnError: true as const } : {});
  return files.flatMap(file => {
    const main = "main" + extname(file.name);
    const passing = file.cases.map(({ name }) => name).filter(name => !failure(name));
    const together = { name: `${file.name}, its cases in one program.`, isAlwaysRun: true, ...common, ...error(passing), make: () => ({ file: main, text: textOf(file, name => passing.includes(name)) }) };
    return [
      ...(passing.length ? [together] : []),
      ...file.cases.map(({ name }) => ({
        name: `${name}, alone.`,
        isAlwaysRun: alwaysAlone.has(name),
        failsToday: failure(name),
        ...common,
        ...error([name]),
        make: () => ({ file: main, text: textOf(file, other => other === name) }),
      })),
    ];
  });
}

/** `<folder> [--sample=<how many>] [--only=<regex over names>]` */
export function writeCaseFiles(files: CaseFile[], words = process.argv.slice(2)) {
  const folder = words[0];
  const option = (name: string) => words.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const only = new RegExp(option("only") ?? "");
  const matching = files.flatMap(file => file.cases.map(({ name }) => name)).filter(name => only.test(name));
  const kept = new Set(option("sample") ? spread(matching, Number(option("sample"))) : matching);
  const isKept = (name: string) => kept.has(name);
  const written = files.filter(file => file.cases.some(({ name }) => isKept(name)));
  mkdirSync(folder, { recursive: true });
  for (const file of written) writeFileSync(join(folder, file.name), textOf(file, isKept));
  console.log(`${kept.size} cases in ${written.length} files`);
}
