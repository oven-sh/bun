// One program, one answer: what flow finds may not hang on the order in which its rules run. `--aot-testing=DelayFlowRules`, `DelayOtherFlowRules` and both together are three
// other valid schedules: about half of the rules that are due in a round wait for a later one. Once the order alone moved the code of a server by 17 percent: a rule used
// every member of `console` if it looked before the value nobody knows had come to hide `console`, and none if it looked behind it.
//
// Here two programs that are mostly code of Bun's library are built under the usual schedule and the three others. They answer the same, and the code stays within `mostSpread` of the
// usual schedule's. The aim is the same bytes. Each prints a line that begins with SCHEDULES. ./variant-flow-rules-delayed-*.test.ts run the programs under ./programs;
// ./servers/schedules.test.ts does the same as this file for the servers that need packages.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { buildUnderEachSchedule, run } from "./harness/flow-schedules";
import { pathOfWrittenProgram } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(600_000);

async function answersTheSameUnderEachSchedule(name: string, directory: string, entry: string) {
  const built = await buildUnderEachSchedule(name, directory, entry);
  const answers = await Promise.all(built.map(it => run([it.executable], directory)));
  for (const answer of answers) expect(answer).toEqual(answers[0]);
  return answers[0];
}

test("a program that imports eleven modules of node answers the same, with about the same code, under every schedule", async () => {
  using dir = tempDir("aot-flow-schedules-modules", {});
  const directory = String(dir);
  // As JavaScript: it has no type of its own, and the types of node are not beside it here.
  cpSync(
    join(
      import.meta.dir,
      "programs",
      "builtin-modules",
      "eleven-node-modules-are-imported-and-every-pass-is-verified.ts",
    ),
    join(directory, "modules.js"),
  );
  expect((await answersTheSameUnderEachSchedule("modules", directory, "modules.js")).exitCode).toBe(0);
});

test("a server on node:http answers the same, with about the same code, under every schedule", async () => {
  using dir = tempDir("aot-flow-schedules-server", {
    "server.js": `import { createServer } from "node:http";
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("hello " + request.url);
});
server.listen(0, async () => {
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/a");
  console.log(response.status, response.headers.get("Content-Type"), await response.text());
  server.close();
});
`,
  });
  expect(await answersTheSameUnderEachSchedule("server", String(dir), "server.js")).toEqual({
    stdout: "200 text/plain hello /a\n",
    errors: [],
    exitCode: 0,
  });
});

// An object of the host, the exports of a library module or an evaluator stands beside a value nobody knows at a parameter that is handed on to unknown code. Which of its members are kept and unlocked hangs on whether the
// parameter lists it. Once a parameter that held the value nobody knows took no more, so the answer hung on which of the two came first: on the number of calls in between, and, where both came at once, on the schedule.
for (const program of [
  "the-exports-of-library-modules-beside-a-hidden-value-are-called-under-hidden-keys",
  "the-exports-of-library-modules-arrive-late-beside-a-hidden-value-and-are-called-under-hidden-keys",
  "members-of-process-are-stored-where-process-stands-beside-a-hidden-value",
  "evaluators-and-a-loader-beside-a-hidden-value-are-called",
  "evaluators-and-a-loader-arrive-late-beside-a-hidden-value-and-are-called",
]) {
  test(`${program}: as plain Bun under every schedule`, async () => {
    using dir = tempDir("aot-flow-schedules-listed", {});
    const directory = String(dir);
    cpSync(join(import.meta.dir, "programs", "soundness", `${program}.mjs`), join(directory, "program.mjs"));
    expect(await answersTheSameUnderEachSchedule("program", directory, "program.mjs")).toEqual(
      await run([bunExe(), "program.mjs"], directory),
    );
  });
}

// An object of the host is not followed that far: where `process` comes late, the store to one of its members is refused, as the page says of built-in objects. It is refused under every schedule.
test("members-of-process-are-stored-where-process-arrives-late-beside-a-hidden-value: one answer under every schedule", async () => {
  using dir = tempDir("aot-flow-schedules-listed", {});
  const directory = String(dir);
  const program = "members-of-process-are-stored-where-process-arrives-late-beside-a-hidden-value";
  cpSync(join(import.meta.dir, "programs", "soundness", `${program}.mjs`), join(directory, "program.mjs"));
  expect(await answersTheSameUnderEachSchedule("program", directory, "program.mjs")).toEqual({
    stdout: await Bun.file(join(import.meta.dir, "programs", "soundness", `${program}.expected.txt`)).text(),
    errors: [],
    exitCode: 0,
  });
});

// The loader is reached through a built-in whose meaning is code of the library, one body for all calls. There `process`, or the built-in `call` itself, stands beside a value nobody knows, and once it
// had escaped no rule saw it any more: the executable refused the load ("can't load a module from a dynamic path") under some schedules and not under others.
for (const way of ["by-reflect-get", "by-call-of-call"]) {
  for (const member of ["buffer-is-utf8", "events-get-event-listeners", "fs-stat-sync", "net-is-ipv6"]) {
    const program = pathOfWrittenProgram(`ways-into-library-modules/${member}-through-get-builtin-module-${way}`)!;
    test(`${member}: process.getBuiltinModule ${way} loads the module under every schedule`, async () => {
      using dir = tempDir("aot-flow-schedules-loader", {});
      const directory = String(dir);
      cpSync(program, join(directory, "program.js"));
      expect(await answersTheSameUnderEachSchedule("program", directory, "program.js")).toEqual(
        await run([bunExe(), "program.js"], directory),
      );
    });
  }
}
