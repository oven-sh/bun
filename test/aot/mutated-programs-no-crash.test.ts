// Mutation fuzzer for the compiler front end. Takes the single-file programs under test/aot/programs, breaks each one a little
// (drops a line or a token, swaps identifiers, drops an initializer, changes a type annotation, inserts a keyword or a
// bracket, truncates the file) and runs `bun check --aot` on the result. A broken program must get diagnostics or pass;
// a panic, a crash or a hang is a bug. Fixed cases found this way are in invalid-programs-no-crash.test.ts.
//
//   bun test test/aot/mutated-programs-no-crash                        300 mutants that are always the same, and 300 from a seed that no run has used
//   AOT_FUZZ_MUTANTS=50000 AOT_FUZZ_SEED=7 bun test test/aot/mutated-programs-no-crash
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { freshSeed } from "./fresh-seed";
import { withPackedPrograms } from "./generate";
import { unsupported } from "./run-programs";

const mutantCount = Number(process.env.AOT_FUZZ_MUTANTS) || 300;
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
  for (const entry of entries) {
    if (entry.isDirectory()) singleFilePrograms(join(folder, entry.name), into);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) into.push(join(folder, entry.name));
  }
  return into;
}

const token = /[A-Za-z_$][\w$]*|\d[\w.]*|=>|\.\.\.|[{}()\[\];,.:?=<>!+\-*/%&|^~]/g;
const types = [
  "number",
  "string",
  "boolean",
  "undefined",
  "null",
  "never",
  "unknown",
  "any",
  "object",
  "symbol",
  "bigint",
  "void",
  "this",
  "number[]",
  "{}",
  "() => void",
];
// prettier-ignore
const keywords = ["const", "let", "var", "using", "class", "enum", "namespace", "interface", "type", "function", "export", "declare", "abstract", "static", "async", "await", "yield", "new", "super", "this", "return", "extends", "implements", "readonly", "get", "set", "import", "default", "as", "satisfies", "typeof", "keyof", "in", "of", "is", "asserts", "label:"];
const punctuation = ["(", ")", "{", "}", "[", "]", "<", ">", ";", ",", ":", "?", "=", ".", "!", "#x", "@d", "`", '"'];

function mutate(source: string, random: () => number): string {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const replace = (match: RegExpMatchArray, text: string) =>
    source.slice(0, match.index) + text + source.slice(match.index! + match[0].length);
  const tokens = [...source.matchAll(token)];
  if (!tokens.length) return source;
  const lines = source.split("\n");
  const line = Math.floor(random() * lines.length);
  switch (Math.floor(random() * 9)) {
    case 0:
      return lines.toSpliced(line, 1).join("\n");
    case 1:
      return replace(pick(tokens), "");
    case 2:
      return lines.toSpliced(line, 0, lines[line]).join("\n");
    case 3: {
      const names = tokens.filter(match => /^[A-Za-z_$]/.test(match[0]));
      return names.length ? replace(pick(names), pick(names)[0]) : source;
    }
    case 4: {
      const initializers = [...source.matchAll(/ = [^;,\n]+/g)];
      return initializers.length ? replace(pick(initializers), "") : source;
    }
    case 5: {
      const annotations = [...source.matchAll(/: (number|string|boolean|[A-Z]\w*)/g)];
      return annotations.length ? replace(pick(annotations), ": " + pick(types)) : source;
    }
    case 6:
      return source.slice(0, pick(tokens).index);
    case 7: {
      const at = pick(tokens);
      return replace(at, pick(keywords) + " " + at[0]);
    }
    default: {
      const at = pick(tokens);
      return replace(at, pick(punctuation) + at[0]);
    }
  }
}

for (const seed of seeds)
  test.skipIf(!!unsupported)(
    `bun check --aot survives ${mutantCount} mutated programs, AOT_FUZZ_SEED=${seed}`,
    async () => {
      using root = tempDir("aot-mutated-programs", {});
      const kept = join(import.meta.dir, "programs");
      const { paths: programs, textOf } = withPackedPrograms(kept, singleFilePrograms(kept), /(?<!\.d)\.ts$/);
      const random = mulberry32(seed);
      const crashes: { from: string; outcome: string; source: string }[] = [];
      let next = 0;
      const worker = async (id: number) => {
        const folder = join(String(root), String(id));
        mkdirSync(folder);
        const entryPoint = join(folder, "main.ts");
        while (next++ < mutantCount) {
          const from = programs[Math.floor(random() * programs.length)];
          let source = mutate(textOf(from), random);
          if (random() < 0.3) source = mutate(source, random);
          writeFileSync(entryPoint, source);
          await using spawned = Bun.spawn({
            cmd: [bunExe(), "check", "--aot", entryPoint],
            cwd: folder,
            env: bunEnv,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            timeout: 120_000,
          });
          const [stdout, stderr] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
          const panic = /\bpanic\w*\b.*/.exec(stdout + stderr)?.[0];
          if (spawned.signalCode || panic)
            crashes.push({
              from: from.slice(import.meta.dir.length + 1),
              outcome: panic ?? String(spawned.signalCode),
              source,
            });
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, availableParallelism() >> 1) }, (_, id) => worker(id)));
      expect(crashes).toEqual([]);
    },
    Math.max(300_000, mutantCount * 400),
  );
