// One program, one answer: what flow finds may not hang on the order in which its rules run. `--aot-testing=DelayFlowRules`, `DelayOtherFlowRules` and both together are three
// other valid schedules: about half of the rules that are due in a round wait for a later one. Once the order alone moved the code of a server by 17 percent: a rule used
// every member of `console` if it looked before the value nobody knows had come to hide `console`, and none if it looked behind it.
//
// Here two programs that are mostly code of Bun's library are built under the usual schedule and the three others. They answer the same, and the code stays within `mostSpread` of the
// usual schedule's. The aim is the same bytes. Each prints a line that begins with SCHEDULES. ./variant-flow-rules-delayed-*.test.ts run the programs under ./programs;
// ./servers/schedules.test.ts does the same as this file for the servers that need packages.
import { expect, setDefaultTimeout } from "bun:test";
import { tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { buildUnderEachSchedule, run } from "./harness/flow-schedules";
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
