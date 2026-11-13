// reader.mjs makes an object below a literal and stores another such object under `request`; a getter above reads through it. company.mjs, which reader.mjs never names, stores whatever it likes under `request` on an object of its own.
// Both objects are lost among strangers. The proofs tie the appended fields of lost layouts to one place a name for the whole program. What is EXPECTED of reader's field was read off that place too:
// the getter was 183 bytes alone and 33 beside the neighbor. How a function is compiled may not hang on the rest of the program.
// The control: whatever else is stored under the name, by whatever road, is what the getter finds.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { test } from "./supported";

const reader = `const requestAbove = { get size() { return this.raw.length; } };
const contextAbove = { get width() { return this.request.size; } };
function make(raw) {
  const context = Object.create(contextAbove);
  const request = context.request = Object.create(requestAbove);
  request.raw = raw;
  request.context = context;
  return context;
}
globalThis.make = make;
globalThis.kept = [make("a"), { other: 1 }, [2]];
`;
const company = `const above = { get none() { return 0; } };
function build(held) {
  const holder = Object.create(above);
  holder.request = held;
  return holder;
}
globalThis.build = build;
globalThis.keptToo = [build(1), build("text"), build({ deep: 1 }), build([3]), build(() => 4), { another: 1 }];
`;
const asks = `console.log(globalThis.make(JSON.parse('"abc"')).width);\n`;

test.skipIf(!!without("testaot"))(
  "a neighbor that stores under the same name changes nothing of what is expected of an appended field",
  async () => {
    using dir = tempDir("aot-a-neighbor-that-stores-under-the-same-name", {
      "reader.mjs": reader,
      "company.mjs": company,
      "main-alone.mjs": `import "./reader.mjs";\n${asks}`,
      "main-company.mjs": `import "./reader.mjs";\nimport "./company.mjs";\n${asks}`,
    });
    const cwd = String(dir);
    const said: Record<string, string> = {};
    for (const name of ["alone", "company"]) {
      const [executable, wire] = [join(cwd, `program-${name}`), join(cwd, `${name}.wire`)];
      const build = [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        `--aot-out=${wire}`,
        `main-${name}.mjs`,
        "--outfile",
        executable,
      ];
      expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
      expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe("3");
      const held = (await runTestaot("link", wire, "held", "fields", "exclude=CodeOutsideImage")).lines;
      said[name] = held
        .find(line => line.includes(' "request" '))!
        .split(" ")
        .slice(2, 4)
        .join(" ")
        .replace(/L\d+/g, "L");
    }
    expect(said).toEqual({ alone: '"request" proven=L', company: '"request" proven=L' });
  },
  240_000,
);

test("what is stored under the name by other roads is what the getter finds", async () => {
  using dir = tempDir("aot-an-appended-field-written-by-other-roads", {
    "main.mjs": `const innerAbove = { get size() { return "inner " + this.raw; } };
const above = { get width() { return this.request.size; } };
function make(raw) {
  const made = Object.create(above);
  const inner = made.request = Object.create(innerAbove);
  inner.raw = raw;
  return made;
}
globalThis.make = make;
globalThis.kept = [make("k"), { other: 1 }, [2]];
function read(made) { return made.width; }
const said = [];
const one = make(JSON.parse('"a"'));
said.push(read(one), read(one));
const key = JSON.parse('["request"]')[0];
one[key] = { size: "by an unknown key" };
said.push(read(one));
for (const lost of globalThis.kept) lost.request = { size: "through a lost subject" };
said.push(read(globalThis.kept[0]));
Object.assign(one, { request: { size: "by a copy" } });
said.push(read(one));
Object.defineProperty(one, "request", { get() { return { size: "by an accessor" }; } });
said.push(read(one));
const two = make("b");
two.request = 7;
said.push(read(two));
delete two.request;
try { said.push(read(two)); } catch (error) { said.push(error.constructor.name); }
console.log(said.join(" | "));
`,
  });
  const cwd = String(dir);
  const executable = join(cwd, "program");
  const build = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--aot-testing=CheckProofsAtRunTime,CheckWalkAtRunTime",
    "main.mjs",
    "--outfile",
    executable,
  ];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  const compiled = await run([executable], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout:
      "inner a | inner a | by an unknown key | through a lost subject | by a copy | by an accessor |  | TypeError\n",
    exitCode: 0,
  });
}, 240_000);
