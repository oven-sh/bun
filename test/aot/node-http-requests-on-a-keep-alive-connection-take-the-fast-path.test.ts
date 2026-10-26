// In an executable the node:http server dispatches a request on its fast path, keeps the headers of the response in their compact
// form and finishes it in a single process.nextTick(). This pins how many requests of ordinary applications take each of the three.
// test/js/node/http/node-http-fast-path-coverage.test.ts says how the fixture tells them apart, and measures it under `bun run`.
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixture, measure, stacks } from "../js/node/http/node-http-fast-path-coverage";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

setDefaultTimeout(240_000);

const directory = String(tempDir("aot-node-http-fast-path", {}));
const executable = join(directory, isWindows ? "server.exe" : "server");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

beforeAll(async () => {
  const cmd = [bunExe(), "build", "--compile", "--aot", fixture, "--outfile", executable];
  const { stderr, exitCode } = await run(cmd, dirname(fixture), bunEnv);
  expect({ errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    errors: [],
    exitCode: 0,
  });
});

describe.concurrent("requests on a keep-alive connection take the fast path", () => {
  test.each(stacks)("%s", async (stack, expected) => {
    expect(await measure([executable, stack])).toEqual(expected);
  });
});
