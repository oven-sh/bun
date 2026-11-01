import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Fake timers replace the global timer functions. As in Node, the timers of Bun's own modules go on: in `bun test` a bare `setTimeout` of node:net is
// a read that no script reaches (nativeFunctions in src/codegen/replacements.ts). `bun test --aot` answers the same, however the store is written.
const program = join(import.meta.dir, "parallel", "replaced-globals", "clock-package");
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
  "node_modules/fake-clock/package.json": readFileSync(
    join(program, "node_modules", "fake-clock", "package.json"),
    "utf8",
  ),
  "node_modules/fake-clock/index.js": readFileSync(join(program, "node_modules", "fake-clock", "index.js"), "utf8"),
  "node_modules/fake-clock/global.js": readFileSync(join(program, "node_modules", "fake-clock", "global.js"), "utf8"),
  "main.mjs": readFileSync(join(program, "main.mjs"), "utf8"),
  "clock.test.mjs": `import { test } from "bun:test";\ntest("the clock of a package", async () => { await import("./main.mjs"); }, 20000);\n`,
  "own.test.mjs": `
    import { afterEach, jest, test } from "bun:test";
    import { once } from "node:events";
    import net from "node:net";
    afterEach(() => jest.useRealTimers());
    test("the clock of bun:test", async () => {
      jest.useFakeTimers();
      const server = net.createServer(() => {}); server.listen(0); await once(server, "listening");
      const socket = net.connect(server.address().port); await once(socket, "connect");
      let fired = false; socket.setTimeout(60_000, () => (fired = true));
      jest.advanceTimersByTime(120_000); await Promise.resolve();
      console.log("bun:test, two minutes on the clock: the socket's timeout", fired ? "fired" : "did not fire", "| the clock counts", jest.getTimerCount());
      socket.setTimeout(30); await once(socket, "timeout");
      console.log("bun:test, a socket's timeout of 30 ms: fired by itself");
      socket.destroy(); server.close();
    }, 5000);`,
};

const seen = async (dir: string, file: string, ...flags: string[]) => {
  const { stdout, exitCode } = await run([bunExe(), "test", file, ...flags], dir, bunEnv);
  return { exitCode, lines: stdout.split("\n").filter(line => /clock|timeout|request/.test(line)) };
};

test("the clock of bun:test leaves the library's timers alone", async () => {
  using dir = tempDir("fake-clock-own", files);
  const plain = await seen(String(dir), "own.test.mjs");
  expect(plain).toEqual({
    exitCode: 0,
    lines: [
      "bun:test, two minutes on the clock: the socket's timeout did not fire | the clock counts 0",
      "bun:test, a socket's timeout of 30 ms: fired by itself",
    ],
  });
  expect(await seen(String(dir), "own.test.mjs", "--aot")).toEqual(plain);
});

// It stores under a computed key, on a parameter, in a file of its own: no reading of the program finds that store, and none is asked for.
test("the clock of a package leaves the library's timers alone", async () => {
  using dir = tempDir("fake-clock-package", files);
  const plain = await seen(String(dir), "clock.test.mjs");
  expect(plain.exitCode).toBe(0);
  expect(plain.lines).toEqual([
    "two minutes on the clock: the socket's timeout did not fire | the clock counts 0",
    "a socket's timeout of 30 ms: fired by itself",
    "a request: ok | the clock counts 0",
  ]);
  expect(await seen(String(dir), "clock.test.mjs", "--aot")).toEqual(plain);
});
