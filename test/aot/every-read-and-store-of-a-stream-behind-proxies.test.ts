// A program may lay a proxy in place of the state of a stream or of the table of its listeners, and then it sees every read and every store that the library makes there.
// The second texts of node:stream and node:events (src/js/ahead-of-time), which the compiler reads, have to make those of the first.
// every-read-and-store-of-a-stream-behind-proxies/main.cjs prints a line for each deed under each way to watch: `<way> <deed>: <how many>: <the reads and stores>`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { eachRow, gap, test } from "./supported";

const program = join(import.meta.dir, "every-read-and-store-of-a-stream-behind-proxies", "main.cjs");

const flagsOfAWrite =
  "a wrong answer today: under `bun build --compile --aot` a write asks the state of a Writable for its flags three to six times less often, where `bun <file>` asks once a question, as node does";
const markOfAList =
  "a wrong answer today: under `bun build --compile --aot` removeListener() leaves the one listener that is left of two without a read of `warned` off the list, where `bun <file>` reads it";
// What is owed, by the head of the line. Every other line is held.
const owed: Record<string, string> = {
  "e unpiped": markOfAList,
  "re unpiped": markOfAList,
  "e listeners go": markOfAList,
  "e those who watch the listeners": markOfAList,
  ...Object.fromEntries(
    ["w", "rwe"].flatMap(way =>
      [
        "written",
        "written, done later",
        "ended",
        "corked",
        "what it says of itself",
        "a transform",
        "a transform that pushes",
        "through a pipeline",
        "a duplex",
      ].map(deed => [`${way} ${deed}`, flagsOfAWrite]),
    ),
  ),
};

const headOf = (line: string) => line.slice(0, line.indexOf(":"));

async function printBoth() {
  using folder = tempDir("every-read-and-store-of-a-stream-behind-proxies", {});
  const executable = join(String(folder), "program" + (isWindows ? ".exe" : ""));
  built(
    await spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], String(folder), bunEnv),
  );
  const [plain, compiled] = [
    await spawned([bunExe(), program], String(folder), bunEnv),
    await spawned([executable], String(folder), bunEnv),
  ];
  expect({ plain: plain.exitCode, compiled: compiled.exitCode }).toEqual({ plain: 0, compiled: 0 });
  return { plain: plain.stdout.trimEnd().split("\n"), compiled: compiled.stdout.trimEnd().split("\n") };
}
let printed: ReturnType<typeof printBoth> | undefined;
const both = () => (printed ??= printBoth());

test("every line that is not owed is the line of plain Bun", async () => {
  const { plain, compiled } = await both();
  expect(plain.length).toBeGreaterThan(200);
  expect(compiled.map(headOf)).toEqual(plain.map(headOf));
  // A line that is owed is found by its head.
  for (const head in owed)
    expect({ head, lines: plain.filter(line => headOf(line) === head).length }).toEqual({ head, lines: 1 });
  expect(compiled.filter(line => !(headOf(line) in owed))).toEqual(plain.filter(line => !(headOf(line) in owed)));
});

eachRow(Object.entries(owed).map(([head, why]) => gap(why, [head] as const)))("%s", async head => {
  const { plain, compiled } = await both();
  expect(compiled.find(line => headOf(line) === head)).toBe(plain.find(line => headOf(line) === head)!);
});
