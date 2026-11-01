import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "./declare";

const program = (end: string) => `
  import { mkdtempSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { ownTemporaryFolder, removeOwnFoldersWhenStopped } from ${JSON.stringify(join(import.meta.dir, "temporary-folders.ts"))};
  removeOwnFoldersWhenStopped();
  const folder = ownTemporaryFolder(mkdtempSync(join(tmpdir(), "asked-to-stop-")));
  writeFileSync(join(folder, "file"), "x");
  console.log(folder);
  ${end}
`;

async function start(end: string) {
  const child = Bun.spawn({ cmd: [bunExe(), "-e", program(end)], env: bunEnv, stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const folder = text.trim();
  expect(folder).toContain("asked-to-stop-");
  return { child, folder };
}

test.skipIf(isWindows).each(["SIGTERM", "SIGINT", "SIGHUP"] as const)(
  "a program that gets %s removes the folders it has made",
  async signal => {
    const { child, folder } = await start("setInterval(() => {}, 1000);");
    expect(existsSync(join(folder, "file"))).toBe(true);
    child.kill(signal);
    expect(await child.exited).toBe(128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal]);
    expect(existsSync(folder)).toBe(false);
  },
);

test("a program that ends with an exception removes the folders it has made", async () => {
  const { child, folder } = await start(`throw new Error("on purpose");`);
  expect(await child.exited).toBe(1);
  expect(existsSync(folder)).toBe(false);
});
