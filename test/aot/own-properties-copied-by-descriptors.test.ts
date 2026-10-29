// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) makes one object for each property and one for them all, only to take
// them apart again. Where the call alone has the descriptors, compiled code makes two calls of the run time, each where its call stood, and for an
// ordinary source they make none of them.
// programs/definitions-by-descriptor/own-properties-copied-by-their-descriptors.js holds what the copy does against plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";
import { built, spawned } from "./run-programs";

const env = { ...bunEnv, NO_COLOR: "1" };

// Many literals of different shapes through one function, as a registry of tools or routes is built.
const members = ["call", "check", "label", "map", "render", "summary", "validate", "alpha", "beta", "gamma", "delta"];
const literals = Array.from({ length: 60 }, (_, index) => {
  const chosen = members.filter(
    (_, position) => (index >> (position % 5)) % 2 === 0 || position === index % members.length,
  );
  const methods = chosen.map(name => `${name}(input) { return ${index}; }`);
  const accessor = index % 3 === 0 ? [`get schema() { return { kind: ${index} }; }`] : [];
  return `built.push(build({ name: "tool${index}", ${[...methods, ...accessor].join(", ")} }));`;
});
const program = `
const defaults = { isEnabled: () => true, label: () => "", aliases: [], render: () => null };
function build(definition) {
  return Object.defineProperties({ ...defaults, shownName: () => definition.name }, Object.getOwnPropertyDescriptors(definition));
}
const built = [];
${literals.join("\n")}
let schemas = 0;
for (const tool of built) schemas += tool.schema === undefined ? 0 : 1;
console.log(built.length, schemas, built[7].shownName(), Object.keys(built[3]).join());
`;

function callsIn(output: string) {
  const callsOf = (overload: string) =>
    output.split("\n").filter(line => line.includes(` overload=${overload}/`)).length;
  return {
    fused: callsOf("CompilerHelpersDefinePropertiesFrom"),
    descriptions: callsOf("ObjectGetOwnPropertyDescriptors"),
    definitions: callsOf("ObjectDefineProperties"),
  };
}

test("no object describes a property on its way from one object to another", async () => {
  using dir = tempDir("aot-copied-by-descriptors", { "main.js": program });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const build = await spawned(
    [
      bunExe(),
      ...compileCommand,
      "--explain=statistics",
      writesProgramInto(folder),
      "main.js",
      "--outfile",
      executable,
    ],
    folder,
    env,
  );
  built(build);
  expect(callsIn(await printIR(folder, { until: "Select" }))).toEqual({ fused: 1, descriptions: 0, definitions: 0 });
  const output = build.stdout + build.stderr;
  expect(Number(/^NativeFunctionsCalledDirectly (\d+)$/m.exec(output)?.[1])).toBeGreaterThan(0);

  const plain = await spawned([bunExe(), "main.js"], folder, env);
  expect(plain.exitCode).toBe(0);
  expect(await spawned([executable], folder, env)).toEqual(plain);
}, 300_000);

// What the program prints is held against plain Bun with the other programs of its folder.
test("nor where the copies behind a typed read join between the two calls", async () => {
  const programs = join(import.meta.dir, "programs", "definitions-by-descriptor");
  using dir = tempDir("aot-copied-behind-a-typed-read", {});
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const source = "own-properties-copied-behind-a-typed-read.ts";
  built(
    await spawned(
      [bunExe(), ...compileCommand, writesProgramInto(folder), source, "--outfile", executable],
      programs,
      env,
    ),
  );
  const calls = callsIn(await printIR(folder, { until: "Select" }));
  expect(calls.fused).toBeGreaterThan(0);
  expect(calls).toEqual({ fused: calls.fused, descriptions: 0, definitions: 0 });
}, 300_000);
