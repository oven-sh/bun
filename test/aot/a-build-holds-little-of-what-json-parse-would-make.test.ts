// Runs alone: it judges by the memory that a build holds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// A build runs the start of a program ahead of time to learn which patterns it makes, and enters JSON.parse on the way.
// A parse makes a cell out of as little as two characters, so what it may make is counted before it is made, and a parse
// that does not fit is left out. Each program is built beside a twin that differs in one word and parses nothing.
async function build(folder: string, name: string, text: string, said: string) {
  writeFileSync(join(folder, name + ".cjs"), text);
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", `./${name}.cjs`, "--outfile", executable],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  await using ran = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect({ stdout: await ran.stdout.text(), exitCode: await ran.exited }).toEqual({ stdout: said + "\n", exitCode: 0 });
  return built.resourceUsage()!.maxRSS;
}

const room = 256 * 1024 * 1024;

function holdsLittle(what: string, withParse: number, without: number) {
  reads(what, (withParse - without) / room, 1.5, "times the room of a build's first run");
  if (!isASAN && !isDebug) expect((withParse - without) / room).toBeLessThan(1.5);
}

const hoard = (reader: string) => `
let body = "{},";
for (let twice = 0; twice < 15; twice++) body = body + body;
const text = '{"all":[' + body + "{}]}";
const giver = { toString() { return text; } };
function hoard() { const kept = []; for (let turn = 0; turn < 3000; turn++) kept[turn] = ${reader}(giver); return kept.length; }
if (process.argv[2] === "hoard") console.log(hoard(), String(giver).length);
console.log(new RegExp("^" + text.length + "$").test("98316"));
`;

test("a text that an object gives is parsed by no build", async () => {
  using dir = tempDir("aot-json-parse-of-a-giver", {});
  const folder = String(dir);
  const without = await build(folder, "without", hoard("String"), "true");
  const withParse = await build(folder, "with", hoard("JSON.parse"), "true");
  holdsLittle("what a build holds of 3000 parses of a text that an object gives", withParse, without);
}, 240_000);

const written = (reader: string) => `
let table = null;
if (process.argv[2] === "load") table = ${reader}('[${"{},".repeat(10666666)}{}]');
function mark(inner) { return "^" + inner + "$"; }
console.log(table === null, new RegExp(mark("ab")).test("ab"));
`;

test("a written text of 32 MB is parsed by no build", async () => {
  using dir = tempDir("aot-json-parse-of-a-long-text", {});
  const folder = String(dir);
  const without = await build(folder, "without", written("String"), "true true");
  const withParse = await build(folder, "with", written("JSON.parse"), "true true");
  holdsLittle("what a build holds of one parse of a written text of 32 MB", withParse, without);
}, 240_000);
