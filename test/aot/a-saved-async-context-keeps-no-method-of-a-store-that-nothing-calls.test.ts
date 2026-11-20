// node:dgram saves the async context of createSocket() and of a queued send(). Where the compiler cannot follow a saved context, it
// takes every AsyncLocalStorage store of the program to be used by code it cannot see, and keeps all that a store names. So a method
// of a store that nothing calls shows it: the report says whether what only that method names was removed. node:child_process
// reaches bind() for a socket that a child receives.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const collation = "Intl.Collator and localeCompare (";

test.concurrent.each([
  [
    "binds a node:dgram socket and sends on it",
    `import { createSocket } from "node:dgram";
const socket = createSocket("udp4");
socket.bind(0, "127.0.0.1", () => socket.send("x", socket.address().port, "127.0.0.1", () => socket.close()));`,
  ],
  [
    "spawns a child process",
    `import { spawn } from "node:child_process";
spawn(process.execPath, ["--version"]).on("exit", () => {});`,
  ],
])(
  "a program that %s keeps nothing for a method of a store that it never calls",
  async (_, uses) => {
    using dir = tempDir("aot-saved-context", {
      "main.ts": `// @ts-nocheck
import { AsyncLocalStorage } from "node:async_hooks";
class Store {
  used() { return 1; }
  neverCalled() { return new Intl.Collator("en").compare("a", "b"); }
}
const storage = new AsyncLocalStorage();
const store = new Store();
console.log(storage.run(store, () => store.used()));
${uses}
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ collation: stderr.split("\n").filter(line => line.includes(collation)), exitCode }).toEqual({
      collation: [expect.stringContaining(`aot: trim: removed ${collation}`)],
      exitCode: 0,
    });
  },
  600_000,
);
