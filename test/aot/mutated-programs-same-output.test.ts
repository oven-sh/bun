// Differential mutation fuzzer. Takes single-file programs under test/aot/programs that already print the same compiled and in
// plain Bun, changes each a little (another constant, another operator, one identifier replaced by another, a statement dropped,
// repeated or moved, two arguments swapped), keeps the mutants that still build, and compares the compiled run with plain Bun
// again. It found a memory-safety bug in exception unwinding (calls/exception-through-tail-apply-under-interpreted-caller.ts).
//
//   bun test test/aot/mutated-programs-same-output                     20 programs, 3 mutants each, chosen by a hash of their paths, and 20 more from a seed that no run has used
//   AOT_FUZZ_PROGRAMS=2000 AOT_FUZZ_SEED=7 bun test test/aot/mutated-programs-same-output
//
// A crash of the build or of the compiled program always fails the test. A different output fails it too, except when the compiled
// program reports a type mismatch: a mutant can type-check and still hand a value to a type it does not fit, through `any` or a cast.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { freshSeed } from "./fresh-seed";
import { withPackedPrograms } from "./generate";
import { unsupported } from "./run-programs";

const programCount = Number(process.env.AOT_FUZZ_PROGRAMS) || 20;
const mutantsPerProgram = Number(process.env.AOT_FUZZ_MUTANTS_PER_PROGRAM) || 3;
const seeds = process.env.AOT_FUZZ_SEED
  ? [Number(process.env.AOT_FUZZ_SEED)]
  : freshSeed === undefined
    ? [1]
    : [1, freshSeed];

function mulberry32(state: number) {
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function singleFilePrograms(folder: string, into: string[] = []) {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (entries.some(entry => entry.isFile() && entry.name.startsWith("main."))) return into;
  const names = new Set(entries.map(entry => entry.name));
  for (const entry of entries) {
    if (entry.isDirectory()) singleFilePrograms(join(folder, entry.name), into);
    else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !names.has(entry.name.slice(0, -3) + ".json")
    )
      into.push(join(folder, entry.name));
  }
  return into;
}

// prettier-ignore
const numbers = ["0", "1", "-1", "2", "0.5", "-0", "255", "256", "65536", "2147483647", "2147483648", "-2147483648", "4294967295", "1e21", "1e-7", "9007199254740991", "3"];
// prettier-ignore
const operatorGroups = [["+", "-", "*", "/", "%", "**"], ["<", "<=", ">", ">="], ["===", "!=="], ["&&", "||", "??"], ["&", "|", "^"], ["<<", ">>", ">>>"], ["+=", "-=", "*="]];
const binaryOperator =
  /(?<=[\w)\] ]) (\*\*|>>>|<<|>>|===|!==|<=|>=|&&|\|\||\?\?|\+=|-=|\*=|[-+*/%<>&|^]) (?=[\w(\[" ])/g;

function mutate(source: string, random: () => number): string {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const splice = (start: number, length: number, text: string) =>
    source.slice(0, start) + text + source.slice(start + length);
  const lines = source.split("\n");
  const codeLines = lines.flatMap((line, index) => (line.trim() && !line.trimStart().startsWith("//") ? [index] : []));
  if (!codeLines.length) return source;
  switch (Math.floor(random() * 8)) {
    case 0: {
      const literals = [...source.matchAll(/(?<![\w.$"'`])\d+(\.\d+)?(?![\w.])/g)];
      if (!literals.length) return source;
      const literal = pick(literals);
      return splice(literal.index, literal[0].length, pick(numbers));
    }
    case 1:
    case 2: {
      const operators = [...source.matchAll(binaryOperator)];
      if (!operators.length) return source;
      const operator = pick(operators);
      return splice(
        operator.index + 1,
        operator[1].length,
        pick(operatorGroups.find(group => group.includes(operator[1]))!),
      );
    }
    case 3: {
      const names = [...source.matchAll(/(?<![\w.$"'`])[a-z_$][\w$]*(?![\w$"'`:])/g)];
      if (names.length < 2) return source;
      const replaced = pick(names);
      return splice(replaced.index, replaced[0].length, pick(names)[0]);
    }
    case 4:
      return lines.toSpliced(pick(codeLines), 1).join("\n");
    case 5: {
      const line = pick(codeLines);
      return lines.toSpliced(line, 0, lines[line]).join("\n");
    }
    case 6: {
      const pairs = [...source.matchAll(/\(([\w.$]+), ([\w.$]+)\)/g)];
      if (!pairs.length) return source;
      const pair = pick(pairs);
      return splice(pair.index, pair[0].length, `(${pair[2]}, ${pair[1]})`);
    }
    default: {
      const [a, b] = [pick(codeLines), pick(codeLines)];
      [lines[a], lines[b]] = [lines[b], lines[a]];
      return lines.join("\n");
    }
  }
}

async function run(cmd: string[], cwd: string, timeout: number) {
  await using spawned = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout });
  const [stdout, stderr, exitCode] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
  const timedOut = spawned.signalCode === "SIGTERM" || spawned.signalCode === "SIGKILL";
  return { stdout, stderr, exitCode, timedOut, signal: timedOut ? null : spawned.signalCode };
}

// "same", "skipped" (does not build, too slow, or a reported type mismatch), or what went wrong.
async function compare(folder: string, source: string): Promise<string> {
  writeFileSync(join(folder, "main.ts"), source);
  rmSync(join(folder, isWindows ? "compiled.exe" : "compiled"), { force: true });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "./compiled"],
    folder,
    120_000,
  );
  if (built.signal || /\bpanic/.test(built.stdout + built.stderr)) return "the build crashed";
  if (built.timedOut) return "the build hangs";
  if (!existsSync(join(folder, isWindows ? "compiled.exe" : "compiled"))) return "skipped";
  const [compiled, interpreted] = [
    await run(["./compiled"], folder, 30_000),
    await run([bunExe(), "run", "./main.ts"], folder, 30_000),
  ];
  if (compiled.signal) return "the program crashed: " + compiled.signal;
  if (compiled.timedOut || interpreted.timedOut) return "skipped";
  if (compiled.stdout === interpreted.stdout && (compiled.exitCode === 0) === (interpreted.exitCode === 0))
    return "same";
  const said = compiled.stdout + compiled.stderr;
  if (said.includes("(bun compile")) return "skipped";
  // Plain Bun does not enforce the temporal dead zone of top-level classes, and the two run out of stack at different depths.
  if (
    said.includes("before initialization") ||
    said.includes("ReferenceError") ||
    (said + interpreted.stdout + interpreted.stderr).includes("Maximum call stack")
  )
    return "skipped";
  const [ours, theirs] = [compiled.stdout.split("\n"), interpreted.stdout.split("\n")];
  const line = ours.findIndex((text, index) => text !== theirs[index]);
  return `line ${line + 1}: compiled ${JSON.stringify(ours[line]?.slice(0, 100))}, plain ${JSON.stringify(theirs[line]?.slice(0, 100))}, exit codes ${compiled.exitCode} ${interpreted.exitCode}`;
}

for (const seed of seeds)
  test.skipIf(!!unsupported)(
    `mutants of ${programCount} programs print the same compiled and in plain Bun, AOT_FUZZ_SEED=${seed}`,
    async () => {
      using root = tempDir("aot-mutated-programs", {});
      const kept = join(import.meta.dir, "programs");
      const { paths: programs, textOf } = withPackedPrograms(kept, singleFilePrograms(kept), /(?<!\.d)\.ts$/, [
        ".json",
      ]);
      const hashed = programs.map(path => ({
        path,
        hash: Number(Bun.hash.crc32(seed + ":" + path.slice(import.meta.dir.length + 1))),
      }));
      const jobs = hashed
        .sort((a, b) => a.hash - b.hash)
        .slice(0, programCount)
        .map(({ path, hash }) => {
          const random = mulberry32(hash);
          const source = textOf(path);
          return {
            from: path.slice(import.meta.dir.length + 1),
            source,
            mutants: Array.from({ length: mutantsPerProgram }, () => mutate(source, random)),
          };
        });
      const failures: { from: string; outcome: string; source: string }[] = [];
      let next = 0;
      const worker = async (id: number) => {
        const folder = join(String(root), String(id));
        mkdirSync(folder);
        while (next < jobs.length) {
          const { from, source, mutants } = jobs[next++];
          if ((await compare(folder, source)) !== "same") continue;
          for (const mutant of mutants) {
            if (mutant === source) continue;
            const outcome = await compare(folder, mutant);
            if (outcome !== "same" && outcome !== "skipped") failures.push({ from, outcome, source: mutant });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, availableParallelism() >> 1) }, (_, id) => worker(id)));
      expect(failures).toEqual([]);
    },
    Math.max(600_000, programCount * mutantsPerProgram * 4_000),
  );
