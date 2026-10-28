// A compiled program that names a member of a built-in object makes the build count on that member, and the executable keeps
// the member from changing. Native code creates many members late: it puts `subtle` on Crypto.prototype at the first read of
// `crypto`, and the getter of `console.Console` puts what it creates in its own place. Such a member must still appear.
//
// The programs here name every member of every global, of its prototype object and of what its data members hold. Each must
// read as in plain Bun: the same `typeof`, the same object at the second read, the same error, and afterwards the same own
// names on its holder. The programs are written by plain Bun, which lists what there is to name.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const numberOfPrograms = 16;

// `env` holds the variables of whoever runs the test, and `bun run` adds some of its own.
const writer = `
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const namesOfTheGlobalObject = new Set(["globalThis", "self", "window", "global"]);
const notRead = new Set(["caller", "arguments", "callee", "env"]);
const seen = new Set([globalThis]);
const isObject = value => value !== null && (typeof value === "object" || typeof value === "function");

function listMembers(path, object, depth, paths, holders) {
  holders.push(path);
  // What an object such as \`crypto\` inherits from the prototype object of its class is read through the object.
  for (let above = Object.getPrototypeOf(object); typeof object === "object" && above && above !== Object.prototype; above = Object.getPrototypeOf(above)) {
    for (const key of Object.getOwnPropertyNames(above)) {
      if (identifier.test(key) && !notRead.has(key) && !Object.hasOwn(object, key) && !paths.includes(path + "." + key)) paths.push(path + "." + key);
    }
  }
  for (const key of Object.getOwnPropertyNames(object)) {
    if (!identifier.test(key) || notRead.has(key)) continue;
    const member = path + "." + key;
    paths.push(member);
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    let value;
    try {
      value = "value" in descriptor ? descriptor.value : depth === 0 ? object[key] : undefined;
    } catch {
      continue;
    }
    if (isObject(value) && !seen.has(value) && depth < 2 && key !== "constructor") {
      seen.add(value);
      listMembers(member, value, depth + 1, paths, holders);
    }
  }
}

const globals = [];
for (const name of Object.getOwnPropertyNames(globalThis).sort()) {
  if (!identifier.test(name) || namesOfTheGlobalObject.has(name)) continue;
  const paths = [name];
  const holders = [];
  let value;
  try {
    value = globalThis[name];
  } catch {
    continue;
  }
  if (isObject(value) && !seen.has(value)) {
    seen.add(value);
    listMembers(name, value, 0, paths, holders);
  }
  globals.push({ paths, holders });
}

const head = \`const lines = [];
function read(path, member) {
  let text;
  try {
    const first = member();
    text = typeof first;
    if (first !== null && (text === "object" || text === "function")) text += member() === first ? ", the same again" : ", another again";
  } catch (error) {
    text = "throws " + error?.constructor?.name;
  }
  lines.push(path + ": " + text);
}
function listNames(path, holder) {
  let text;
  try {
    text = Object.getOwnPropertyNames(holder()).sort().join();
  } catch (error) {
    text = "throws " + error?.constructor?.name;
  }
  lines.push("names of " + path + ": " + text);
}
\`;

const count = Number(process.argv[2]);
for (let program = 0; program < count; program++) {
  let text = head;
  for (let index = program; index < globals.length; index += count) {
    for (const path of globals[index].paths) text += "read(" + JSON.stringify(path) + ", () => " + path + ");\\n";
    for (const path of globals[index].holders) text += "listNames(" + JSON.stringify(path) + ", () => " + path + ");\\n";
  }
  text += 'console.log(lines.join("\\\\n"));\\nprocess.exit(0);\\n';
  require("node:fs").writeFileSync("members-" + program + ".js", text);
}
`;

describe.concurrent("compile/aot/members of globals", () => {
  const dir = tempDir("aot-members-of-globals", { "write-programs.js": writer });
  const folder = String(dir);
  afterAll(() => dir[Symbol.dispose]());

  beforeAll(async () => {
    const wrote = await spawned([bunExe(), "run", "write-programs.js", String(numberOfPrograms)], folder, bunEnv);
    expect({ stderr: wrote.stderr, exitCode: wrote.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(folder).filter(name => name.startsWith("members-")).length).toBe(numberOfPrograms);
  }, 600_000);

  for (let program = 0; program < numberOfPrograms; program++) {
    test(
      `program ${program} of ${numberOfPrograms}`,
      () =>
        slot(async () => {
          const source = `members-${program}.js`;
          const executable = join(folder, `members-${program}` + (isWindows ? ".exe" : ""));
          const plain = await spawned([bunExe(), "run", source], folder, bunEnv);
          expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
          built(await spawned([bunExe(), ...compileCommand, source, "--outfile", executable], folder, bunEnv));
          const compiled = await spawned([executable], folder, bunEnv);
          expect({ signal: compiled.signal, exitCode: compiled.exitCode }).toEqual({ signal: null, exitCode: 0 });
          expect(compiled.stdout.split("\n")).toEqual(plain.stdout.split("\n"));
        }),
      600_000,
    );
  }
});
