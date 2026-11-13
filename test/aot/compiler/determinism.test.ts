// Same sources, same bytes, whatever the number of threads. The application of bench/compiler is built in each dress at 1, 16 and 64 threads.
// The builds of a dress run at once, so that their threads disturb each other. A build counts by its exit code and by the bytes it wrote:
// one that fails is a failure, not a missing sample.
//
// A difference names its stage. Beside each build a second one at the same number of threads writes the program that its front end hands to the engine
// (--aot-out), and testaot prints what Facts and Plan make of one such program at the same numbers of threads. Faults are listed in the order of the
// stages, so the first says where to look:
//   front end                    the programs differ
//   facts, plan                  the texts differ, from the line shown
//   executable with --aot-out    and nothing above: Compile or Image. An id born in the order of threads reached the image, or a sort that reaches it has no total key.
//   executable                   and nothing above: the reading of the bodies. A build that writes its program hands them to the engine inside it, in the program's numbers.
//                                Every other build hands them over beside it, in the numbers of the checker's tasks, and which files share a task follows the schedule.
//
// A race passes most runs, so a test of this file that fails now and then is a race, never a flake. `bun test --rerun-each=100` asks for more runs.
//
// By hand, in a folder that `bun bench/compiler/generate.ts <folder> <features> <dress>` has written (each test prints that command on stderr):
//   bun build --compile --aot --aot-threads=16 main.ts --outfile program
//   bun build --compile --aot --aot-threads=16 --aot-out=program.aot main.ts --outfile writes-program
//   testaot facts $PWD/program.aot enforced references=narrow exclude=CodeOutsideImage,LibraryText threads=16
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isWindows } from "harness";
import { dirname, join } from "path";
import { commandEnv, describeSilentCrash, testaot } from "../engine/testaot";
import { without } from "../harness/capabilities";
import { spawned, unsupported, withoutDebugInformation } from "../harness/commands";
import { compileCommand, withProgramOutput, withThreads, wordsOfAPlainBuild } from "../harness/flags";
import { application, dresses, type Application } from "./measure";

const linesOfApplication = 10_000;
// Fewer threads than cores, as many, and many more: threads that wait for a core stop at other places than threads that run.
const threadCounts = [1, 16, 64];
const limitOfACommand = 300_000;

/** The result of one stage at one thread count. `content`: a text, or the length and hash of a file. */
type Outcome = { content: string } | { failure: string };
type Ended = Awaited<ReturnType<typeof spawned>>;

// The last lines of a failed command's output show how far it got.
const lastLines = (text: string) => {
  const lines = text.split("\n");
  return lines.length <= 40 ? text : `.. ${lines.length - 40} lines ..\n${lines.slice(-40).join("\n")}`;
};
const failureOf = ({ exitCode, signal, stderr, stdout }: Ended) =>
  exitCode === 0 && !signal
    ? undefined
    : [
        `exit code ${exitCode}${signal ? ` ${signal}` : ""}: ${stderr || "no stderr output"}`,
        ...(stdout ? [`printed: ${lastLines(stdout)}`] : []),
      ].join("\n");

// Two missing or empty files would compare equal, so a missing or empty file is a failure.
async function outcomeOfFile(path: string): Promise<Outcome> {
  const bytes = existsSync(path) ? await Bun.file(path).bytes() : new Uint8Array();
  if (!bytes.length) return { failure: "nothing is written" };
  return { content: `${bytes.length} bytes, sha256 ${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}` };
}

function outcomeOfOutput(run: Ended): Outcome {
  // A tool that rejects its arguments prints that to stdout and exits with 0, so three such outputs would compare equal.
  const refusal = run.stdout.startsWith("bad argument") ? run.stdout.trim() : undefined;
  const failure = failureOf(run) ?? refusal ?? (run.stdout ? undefined : "nothing is printed");
  return failure === undefined ? { content: run.stdout } : { failure };
}

const shown = (line: string | undefined) => line?.slice(0, 400) ?? "no line";

function differenceBetween(content: string, reference: string) {
  if (content === reference) return undefined;
  const [lines, others] = [content.split("\n"), reference.split("\n")];
  const found = lines.findIndex((line, index) => line !== others[index]);
  const at = found < 0 ? lines.length : found;
  const where = others.length > 1 ? `line ${at + 1}: ` : "";
  return `${where}${shown(lines[at])} | at threads=${threadCounts[0]}: ${shown(others[at])}`;
}

/** Faults in the order of the stages. A stage's outcomes are in the order of `threadCounts`, and each is compared with the first. */
const faultsOf = (stages: Record<string, Outcome[]>) =>
  Object.entries(stages).flatMap(([stage, outcomes]) =>
    outcomes.flatMap((outcome, index) => {
      const reference = outcomes[0];
      const fault =
        "failure" in outcome
          ? outcome.failure
          : reference && "content" in reference
            ? differenceBetween(outcome.content, reference.content)
            : undefined;
      return fault === undefined ? [] : [`${stage} at threads=${threadCounts[index]}: ${fault}`];
    }),
  );

let carrier: string[] | undefined;

async function buildAt(threads: number, app: Application) {
  // An executable holds its own file name, so the builds that are compared write one name, each into the folder of its thread count.
  const folder = join(app.folder, `threads-${threads}`);
  mkdirSync(folder);
  const program = join(folder, "program.aot");
  const built = async (name: string, flags: string[]): Promise<Outcome> => {
    const executable = join(folder, isWindows ? `${name}.exe` : name);
    const command = [
      bunExe(),
      ...compileCommand,
      withThreads(threads),
      ...flags,
      ...(carrier ??= withoutDebugInformation()),
      app.entry,
      "--outfile",
      executable,
    ];
    const failure = failureOf(await spawned(command, app.folder, bunEnv, limitOfACommand));
    return failure === undefined ? outcomeOfFile(executable) : { failure };
  };
  const [executable, executableWithProgram] = await Promise.all([
    built("program", []),
    built("writes-program", [withProgramOutput(program)]),
  ]);
  const written = await outcomeOfFile(program);
  return {
    program,
    // Where no program is written, the failure of the build says why.
    frontEnd: "failure" in written && "failure" in executableWithProgram ? executableWithProgram : written,
    executableWithProgram,
    executable,
  };
}

// testaot spells an engine flag without --aot-: threads=16.
const wordOf = (flag: string) => flag.replace(/^--aot-/, "");

const printedBy = (command: string, program: string, ...words: string[]) =>
  Promise.all(
    threadCounts.map(async threads => {
      const cmd = [testaot!, command, program, ...words, ...wordsOfAPlainBuild, wordOf(withThreads(threads))];
      const run = await spawned(cmd, dirname(program), commandEnv, limitOfACommand);
      if (run.signal && !run.stderr.trim()) run.stderr = await describeSilentCrash(cmd, dirname(program), commandEnv);
      return outcomeOfOutput(run);
    }),
  );

test("reports each failure and each difference under its stage", () => {
  const alike = { content: "a\nb\n" };
  expect(
    faultsOf({
      "front end": [alike, alike, alike],
      facts: [alike, { content: "a\nc\n" }, { content: "a\n" }],
      executable: [{ content: "1 bytes" }, { failure: "exit code 1" }, { content: "2 bytes" }],
    }),
  ).toEqual([
    "facts at threads=16: line 2: c | at threads=1: b",
    "facts at threads=64: line 2:  | at threads=1: b",
    "executable at threads=16: exit code 1",
    "executable at threads=64: 2 bytes | at threads=1: 1 bytes",
  ]);
});

describe(`the same bytes at ${threadCounts.join(", ")} threads`, () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  const whyNoTexts = without("testaot");
  const executablesSeen = new Set<string>();

  for (const dress of dresses) {
    test(
      dress,
      async () => {
        using app = application(linesOfApplication, dress);
        console.error(`${dress}: bun bench/compiler/generate.ts <folder> ${app.features} ${dress}`);
        const builds = await Promise.all(threadCounts.map(threads => buildAt(threads, app)));
        // Every testaot run reads the same program file, so a front-end difference is not reported again under facts and plan.
        const program = builds.find(build => "content" in build.frontEnd)?.program;
        const [facts, plan]: [Outcome[], Outcome[]] =
          program && !whyNoTexts
            ? await Promise.all([printedBy("facts", program, "enforced"), printedBy("plan", program)])
            : [[], []];
        for (const { executable } of builds) if ("content" in executable) executablesSeen.add(executable.content);
        expect(
          faultsOf({
            "front end": builds.map(build => build.frontEnd),
            facts,
            plan,
            "executable with --aot-out": builds.map(build => build.executableWithProgram),
            executable: builds.map(build => build.executable),
          }),
        ).toEqual([]);
      },
      2 * limitOfACommand + 60_000,
    );
  }

  // A hash that did not depend on the program would also match at every thread count.
  test("another dress has other bytes", () => {
    expect(executablesSeen.size).toBeGreaterThan(1);
  });
});
