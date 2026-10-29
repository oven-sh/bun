// The program names next to nothing. Which names are read and which functions are called is only known at run time, so --trim removes what stands behind them.
// Reading a name gives what it gives in the whole executable. Calling a function that was removed throws an error that the program can catch.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { withoutDebugInformation } from "./harness/without-debug-information";

const evaluates = `import { readFileSync } from "node:fs";
console.log(new Function(readFileSync(process.argv[2], "utf8"))());
process.exit(0);
`;

// A getter of a prototype object refuses the prototype object itself, in both executables.
const readsEveryName = `const seen = new Set();
const lines = [];
const describe = key => (typeof key === "symbol" ? "[" + String(key.description) + "]" : key);
function visit(holder, path, depth) {
  if (seen.has(holder)) return;
  seen.add(holder);
  for (const key of Reflect.ownKeys(holder)) {
    const name = path + "." + describe(key);
    let value;
    try {
      value = holder[key];
    } catch {
      lines.push(name + " throws");
      continue;
    }
    if (value instanceof Promise) value.catch(() => {});
    lines.push(name + " " + typeof value);
    if (value !== null && (typeof value === "object" || typeof value === "function") && depth < 4) visit(value, name, depth + 1);
  }
}
visit(globalThis, "globalThis", 0);
return lines.join("\\n");
`;

const holders = ["Bun", "process", "globalThis", "console", "crypto", "performance"];
// They end, stop or replace the process, wait for a person, or change where its files go.
const notCalled = [
  "exit",
  "reallyExit",
  "abort",
  "kill",
  "_kill",
  "execve",
  "openInEditor",
  "sleepSync",
  "prompt",
  "alert",
  "confirm",
  "chdir",
  "dlopen",
  "_debugProcess",
];

const listsFunctions = `for (const holder of ${JSON.stringify(holders)}) {
  const object = holder === "globalThis" ? globalThis : globalThis[holder];
  const names = new Set();
  for (let o = object; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const name of Object.getOwnPropertyNames(o)) names.add(name);
  for (const name of names) {
    let value;
    try {
      value = object[name];
    } catch {
      continue;
    }
    if (typeof value === "function" && !${JSON.stringify(notCalled)}.includes(name)) console.log(holder, name);
  }
}
`;

// Other features need parts of what starts a process, so a writer, a stream and an HTMLRewriter keep those parts.
const callsByName = `const writer = Bun.stdout.writer();
writer.write("");
await writer.flush();
new ReadableStream({ start(controller) { controller.close(); } });
new HTMLRewriter();
const [, , holder, name] = process.argv;
const object = holder === "globalThis" ? globalThis : globalThis[holder];
for (const text of ${JSON.stringify(["[]", '["x"]', '["x","y"]', '[["echo","hi"]]', '[{"cmd":["echo","hi"]}]', "[{}]", '["/tmp",1]'])}) {
  for (const constructs of [false, true]) {
    const given = JSON.parse(text);
    try {
      const result = constructs ? new object[name](...given) : object[name](...given);
      if (result && typeof result.then === "function") await Promise.race([result, new Promise(resolve => setTimeout(resolve, 20))]);
    } catch {}
  }
}
console.log("reached the end");
process.exit(0);
`;

// Streams need parts of Bun.serve, so a stream keeps those parts. It keeps nothing of what else Bun.serve needs.
const evaluatesBesideStream = `new ReadableStream({ start(controller) { controller.close(); } });
try {
  new Function(process.argv[2])();
  console.log("returned");
} catch (error) {
  console.log("threw", error.code);
}
process.exit(0);
`;

if (!canTrim)
  console.error(
    "SKIPPED: names-from-run-time-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim",
  );

(canTrim && !unsupported ? describe : describe.skip)("in a trimmed executable", () => {
  test(
    "every name that text from run time reads is what it is in the whole executable",
    () =>
      slot(async () => {
        using dir = tempDir("names-from-run-time", { "program.js": evaluates, "text.txt": readsEveryName });
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...withoutDebugInformation, "--aot", "program.js", "--outfile"];
        built(await spawned([...build, "whole"], folder, bunEnv));
        built(await spawned([...build, "trimmed", "--trim"], folder, bunEnv));
        const whole = await spawned([join(folder, "whole"), "text.txt"], folder, bunEnv);
        const trimmed = await spawned([join(folder, "trimmed"), "text.txt"], folder, bunEnv);
        expect(whole.stdout.split("\n").length).toBeGreaterThan(5000);
        const inWhole = new Set(whole.stdout.split("\n"));
        expect(trimmed.stdout.split("\n").filter(line => !inWhole.has(line))).toEqual([]);
        expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({ stdout: whole.stdout, exitCode: 0 });
      }),
    600_000,
  );

  test(
    "a function that stays and would come to what is removed throws",
    () =>
      slot(async () => {
        using dir = tempDir("names-from-run-time", { "program.js": evaluatesBesideStream });
        const folder = String(dir);
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "--trim",
              "program.js",
              "--outfile",
              "trimmed",
            ],
            folder,
            bunEnv,
          ),
        );
        const serves = ["", 'tls: { key: "x", cert: "y" }, ', "development: true, "].map(
          options => `Bun.serve({ port: 0, ${options}fetch() { return new Response("x"); } }).stop();`,
        );
        // console.table is the engine's function, and what prints the table is Bun's.
        for (const text of [...serves, "console.table([{ a: 1 }]);"]) {
          const ran = await spawned([join(folder, "trimmed"), text], folder, bunEnv);
          expect({ text, stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
            text,
            stdout: "threw ERR_FEATURE_REMOVED\n",
            stderr: "",
            exitCode: 0,
          });
        }
      }),
    600_000,
  );

  test(
    "a function that is called by a name from run time returns or throws, and the program goes on",
    () =>
      slot(async () => {
        using dir = tempDir("names-from-run-time", { "program.js": callsByName, "list.js": listsFunctions });
        const folder = String(dir);
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "--trim",
              "program.js",
              "--outfile",
              "trimmed",
            ],
            folder,
            bunEnv,
          ),
        );
        const functions = (await spawned([bunExe(), "list.js"], folder, bunEnv)).stdout.trim().split("\n");
        expect(functions.length).toBeGreaterThan(250);
        const ended: string[] = [];
        const queue = [...functions];
        const work = async () => {
          for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
            const ran = await spawned([join(folder, "trimmed"), ...next.split(" ")], folder, bunEnv);
            if (ran.exitCode !== 0 || !ran.stdout.includes("reached the end\n"))
              ended.push(`${next}: exit code ${ran.exitCode}: ${ran.stderr.slice(0, 200)}`);
          }
        };
        await Promise.all(Array.from({ length: 8 }, work));
        expect(ended.sort()).toEqual([]);
      }),
    600_000,
  );
});
