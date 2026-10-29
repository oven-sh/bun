import { afterAll, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { countsInstructions } from "../analysis-scaling/measure-check";
import { readElfFile } from "../elf-file";
import { slot } from "../harness/commands";
import { run } from "../harness/counted-run";
import { compileCommand } from "../harness/flags";
import { wanted } from "../harness/shares";
import { describe, test } from "../supported";
import { writeCommandLineTool } from "./start/command-line-tool";
import { measureStart, type Start, type Until } from "./start/measure-start";

const numbers = ["thousandInstructions", "pageFaults", "systemCalls", "privateKilobytes"] as const;
const slack: Record<(typeof numbers)[number], number> = {
  thousandInstructions: 40,
  pageFaults: 20,
  systemCalls: 8,
  privateKilobytes: 64,
};
const share: Record<(typeof numbers)[number], number> = {
  thousandInstructions: 0.03,
  pageFaults: 0.2,
  systemCalls: 0.03,
  privateKilobytes: 0.03,
};
const allowed = (budget: number, what: (typeof numbers)[number]) => budget * (1 + share[what]) + slack[what];

// With musl a start executes some six million instructions more than with glibc, whatever the program. So a row has its instructions twice, and a start is held
// to the number of the library that its Bun was built for. The other numbers are those of glibc, and are held with both.
type Row = Start & { thousandInstructionsWithMusl?: number };
const thousandInstructionsMoreWithMusl = 7_000;
const budgetOf = ({ thousandInstructionsWithMusl, ...row }: Row): Start =>
  !isMusl || row.thousandInstructions === undefined
    ? row
    : {
        ...row,
        thousandInstructions:
          thousandInstructionsWithMusl ?? row.thousandInstructions + thousandInstructionsMoreWithMusl,
      };
const rowWith = (row: Row | undefined, { thousandInstructions, ...rest }: Start): Row =>
  isMusl
    ? { ...row, thousandInstructionsWithMusl: thousandInstructions }
    : { thousandInstructions, thousandInstructionsWithMusl: row?.thousandInstructionsWithMusl, ...rest };

const budgetsPath = join(import.meta.dir, "start.linux-x64.json");
const budgets: Record<string, Row> = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, "utf8")) : {};
const mode = process.env.AOT_BUDGETS;
const skipped =
  !isLinux || process.arch !== "x64"
    ? "the budgets are those of Linux on x64"
    : isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/start.test.ts: ${skipped}`);
// Else all that there is to judge is the memory of a program that stays.
const countsAStart = !skipped && (countsInstructions() || !!Bun.which("strace"));

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")],
    types: ["bun-types"],
    skipLibCheck: true,
    noEmit: true,
  },
});
const answersHello: Until = { route: "/text", answers: "Hello, World!" };

type Program = {
  name: string;
  entry: string;
  arguments?: string[];
  until: Until;
  write(folder: string): void;
};
const written = (entry: string, text: string) => (folder: string) => {
  writeFileSync(join(folder, entry), text);
  writeFileSync(join(folder, "tsconfig.json"), tsconfig);
};

const programs: Program[] = [
  {
    name: "hello-world",
    entry: "main.ts",
    until: { prints: "hello world\n" },
    write: written("main.ts", `console.log("hello world");\n`),
  },
  {
    name: "command-line-tool-of-50-modules",
    entry: "main.ts",
    arguments: ["--version"],
    until: { prints: "cli50 1.2.3\n" },
    write(folder) {
      writeCommandLineTool(folder);
      writeFileSync(join(folder, "tsconfig.json"), tsconfig);
    },
  },
  {
    name: "lazy-exports-imported-by-a-module-that-is-never-loaded",
    entry: "main.ts",
    arguments: ["--version"],
    until: { prints: "1.0 true\n" },
    write(folder) {
      writeFileSync(
        join(folder, "main.ts"),
        `import { existsSync } from "node:fs";\nif (process.argv[2] === "--version") console.log("1.0", existsSync("/"));\nelse await import("./rest.ts");\n`,
      );
      writeFileSync(
        join(folder, "rest.ts"),
        `import { promises, WriteStream } from "node:fs";\nconsole.log(typeof promises, typeof WriteStream);\n`,
      );
      writeFileSync(join(folder, "tsconfig.json"), tsconfig);
    },
  },
  {
    name: "streams-of-the-process-imported-by-a-module-that-is-never-loaded",
    entry: "main.ts",
    arguments: ["--version"],
    until: { prints: "1.0 string\n" },
    write(folder) {
      writeFileSync(
        join(folder, "main.ts"),
        `import { platform } from "node:process";\nif (process.argv[2] === "--version") console.log("1.0", typeof platform);\nelse await import("./rest.ts");\n`,
      );
      writeFileSync(
        join(folder, "rest.ts"),
        `import { stderr, stdin, stdout } from "node:process";\nconsole.log(typeof stderr, typeof stdin, typeof stdout);\n`,
      );
      writeFileSync(join(folder, "tsconfig.json"), tsconfig);
    },
  },
  {
    name: "lazy-exports-bound-by-the-entry-and-used-in-a-function-nobody-calls",
    entry: "main.ts",
    arguments: ["--version"],
    until: { prints: "1.0 true\n" },
    write: written(
      "main.ts",
      `import { createWriteStream, existsSync, WriteStream } from "node:fs";\nexport function later() {\n  return [createWriteStream, WriteStream];\n}\nif (process.argv[2] === "--version") console.log("1.0", existsSync("/"));\nelse console.log(later().length);\n`,
    ),
  },
  {
    name: "bun-serve",
    entry: "main.ts",
    until: answersHello,
    write: written(
      "main.ts",
      `const server = Bun.serve({ port: Number(process.env.PORT), hostname: "127.0.0.1", fetch: () => new Response("Hello, World!") });\nconsole.log("listening", server.port);\n`,
    ),
  },
  {
    name: "node-http",
    entry: "main.ts",
    until: answersHello,
    write: written(
      "main.ts",
      `import { createServer } from "node:http";\nimport type { AddressInfo } from "node:net";\nconst server = createServer((request: unknown, response: { end(text: string): void }) => {\n  response.end("Hello, World!");\n});\nserver.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening", (server.address() as AddressInfo).port));\n`,
    ),
  },
];

// The kernel gives a huge page only to a mapping that covers all of an aligned 2 MB.
test.skipIf(!isLinux || isDebug || isASAN)("the part of Bun that starts as zeros has no room for a huge page", () => {
  expect(readElfFile(bunExe()).largestPartThatStartsAsZeros).toBeLessThan(2 * 1024 * 1024);
});

describe.skipIf(!!skipped)("compile/aot/perf/start", () => {
  const root = String(tempDir("aot-start", {}));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    if (mode)
      writeFileSync(
        budgetsPath,
        JSON.stringify(Object.fromEntries(Object.entries(budgets).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) +
          "\n",
      );
  });

  for (const program of programs) {
    if (wanted !== "quick" && !program.name.includes(wanted)) continue;
    test.skipIf(!countsAStart && !("route" in program.until)).concurrent(
      program.name,
      () =>
        slot(async () => {
          const folder = join(root, program.name);
          mkdirSync(folder);
          program.write(folder);
          const executable = join(folder, "start");
          const built = await run(
            [
              bunExe(),
              ...compileCommand,
              "--define",
              'process.env.NODE_ENV="production"',
              `./${program.entry}`,
              "--outfile",
              executable,
            ],
            folder,
            { ...bunEnv, NO_COLOR: "1" },
          );
          expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
            stderr: expect.not.stringMatching(/^error\b/m),
            exitCode: 0,
          });
          const { mappings, ...now } = await measureStart([executable, ...(program.arguments ?? [])], program.until, 5);
          rmSync(folder, { recursive: true, force: true });

          const budget = budgets[program.name] && budgetOf(budgets[program.name]);
          if (mode === "accept" || !budget) {
            budgets[program.name] = rowWith(budgets[program.name], now);
            console.error(`BUDGET ${program.name}: written: ${JSON.stringify(now)}`);
            expect(["accept", "lower"]).toContain(mode);
            return;
          }
          if (mode === "lower")
            budgets[program.name] = rowWith(
              budgets[program.name],
              Object.fromEntries(
                numbers.flatMap(what =>
                  now[what] === undefined ? [] : [[what, Math.min(now[what], budget[what] ?? Infinity)]],
                ),
              ),
            );
          const judged = numbers.filter(what => now[what] !== undefined && budget[what] !== undefined);
          const moved = (those: readonly (typeof numbers)[number][]) =>
            those.map(what => `${what} ${budget[what]} -> ${now[what]}`).join(", ");
          const worse = judged.filter(what => now[what]! > allowed(budget[what]!, what));
          const better = judged.filter(what => now[what]! < budget[what]! * 0.95 - slack[what]);
          console.error(
            `BUDGET ${program.name}: ${[worse.length ? `WORSE: ${moved(worse)}` : "", better.length ? `better: ${moved(better)}` : ""].filter(Boolean).join("; ") || "within"}`,
          );
          console.error(`NUMBERS ${program.name}: ${JSON.stringify(now)}`);
          if (worse.includes("privateKilobytes")) console.error(`MAPPINGS ${program.name}:\n${mappings}`);
          expect(worse.map(what => `${what}: ${now[what]}, the budget is ${budget[what]}`)).toEqual([]);
        }),
      900_000,
    );
  }

  // The loader, the C library and Bun's own start cost both forms the same. What differs is what compiling ahead of time adds to a start or takes from it.
  test.skipIf(!countsAStart || (wanted !== "quick" && !"hello-world".includes(wanted))).concurrent(
    "hello-world takes no more instructions and system calls than as a plain executable",
    () =>
      slot(async () => {
        const folder = join(root, "hello-world-in-both-forms");
        mkdirSync(folder);
        written("main.ts", `console.log("hello world");\n`)(folder);
        const forms = { plain: ["build", "--compile"], compiled: compileCommand } as const;
        const measured: Partial<Record<keyof typeof forms, Start>> = {};
        for (const form of ["plain", "compiled"] as const) {
          const executable = join(folder, form);
          const built = await run(
            [
              bunExe(),
              ...forms[form],
              "--define",
              'process.env.NODE_ENV="production"',
              "./main.ts",
              "--outfile",
              executable,
            ],
            folder,
            { ...bunEnv, NO_COLOR: "1" },
          );
          expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
            stderr: expect.not.stringMatching(/^error\b/m),
            exitCode: 0,
          });
          const { mappings, ...now } = await measureStart([executable], { prints: "hello world\n" }, 5);
          measured[form] = now;
          console.error(`NUMBERS hello-world, ${form}: ${JSON.stringify(now)}`);
        }
        rmSync(folder, { recursive: true, force: true });
        const more = (["thousandInstructions", "systemCalls"] as const).filter(
          what => (measured.compiled![what] ?? 0) > (measured.plain![what] ?? Infinity),
        );
        expect(more.map(what => `${what}: ${measured.compiled![what]}, plain takes ${measured.plain![what]}`)).toEqual(
          [],
        );
      }),
    900_000,
  );
});
