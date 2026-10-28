import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// An ordinary object is given its names once and is then copied many times, and each copy is given one more name.
const program = (make: string, copy: string) => `
${make}
function withExtra(extra) { ${copy} }
let sum = 0;
const turns = Number(process.env.TURNS);
for (let i = 0; i < turns; i++) { const made = withExtra(i & 7); sum += made.a + made.b + made.extra; }
console.log(sum);
`;
const created = "const defaults = Object.create(Object.prototype); defaults.a = 1; defaults.b = 2;";
const withoutPrototype = "const defaults = Object.create(null); defaults.a = 1; defaults.b = 2;";
const defined = `const defaults = Object.create(Object.prototype); for (const name of ["a", "b"]) Object.defineProperty(defaults, name, { value: 1, writable: true, enumerable: true, configurable: true });`;
const files = {
  "spread.cjs": program(created, "return { ...defaults, extra };"),
  "spread-without-a-prototype.cjs": program(withoutPrototype, "return { ...defaults, extra };"),
  "spread-of-what-was-defined.cjs": program(defined, "return { ...defaults, extra };"),
  "assigned.cjs": program(created, "const made = Object.assign({}, defaults); made.extra = extra; return made;"),
  "stored-by-key.cjs": program(
    created,
    `const made = { ...defaults }; made[["ex", "tra"].join("")] = extra; return made;`,
  ),
  "a-name-is-given-and-deleted.cjs": program(
    created,
    "defaults.tick = extra; const made = { a: defaults.a, b: defaults.b, extra: defaults.tick }; delete defaults.tick; return made;",
  ),
  "a-name-is-given-looked-for-and-deleted.cjs": program(
    withoutPrototype,
    `defaults.tick = extra; let seen = 0; for (const name in defaults) seen++; const made = { a: defaults.a, b: defaults.b + (defaults.missing === undefined ? 0 : seen), extra: defaults.tick }; delete defaults.tick; return made;`,
  ),
  "four-names-are-given-and-deleted.cjs": program(
    created,
    `for (const name of ["p", "q", "r", "s"]) defaults[name] = extra; const made = { a: defaults.a, b: defaults.b, extra: defaults.s }; for (const name of ["p", "q", "r", "s"]) delete defaults[name]; return made;`,
  ),
  "a-listener-is-added-and-removed.cjs": program(
    `const emitter = new (require("node:events"))(); const listener = () => {}; emitter.on("other", listener);`,
    `emitter.on("tick", listener); emitter.off("tick", listener); return { a: emitter.listenerCount("other"), b: 0, extra };`,
  ),
  "the-object-itself-goes-on.cjs": program(
    created + " let more = 0;",
    `defaults["more" + (more++ & 3)] = extra; return { ...defaults, extra };`,
  ),
};

test.each(Object.keys(files))(
  "a thousand turns more make no Structure more: %s",
  async entry => {
    using dir = tempDir("aot-a-copy-of-an-object-that-was-filled-once", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const structuresMade = async (turns: number) => {
      const counts = join(String(dir), `counts-${turns}.txt`);
      const ran = await run([executable], String(dir), {
        ...bunEnv,
        TURNS: String(turns),
        [runtimeEnvironment.countsPath]: counts,
      });
      expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return readFileSync(counts, "utf8")
        .split("\n")
        .filter(line => line.startsWith("made ") && line.includes(" Structure:"))
        .reduce((sum, line) => sum + Number(line.split(" ").at(-2)), 0);
    };
    expect((await structuresMade(2000)) - (await structuresMade(1000))).toBe(0);
  },
  240_000,
);
