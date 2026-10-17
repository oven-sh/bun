import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

test("the Date header of a server is current from the first response on", async () => {
  using dir = tempDir("aot-date-header", {
    "main.ts": `
const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
const read = async () => {
  const before = Math.floor(Date.now() / 1000) * 1000;
  const header = (await fetch(server.url)).headers.get("date")!;
  return { header, isWellFormed: new Date(header).toUTCString() === header, isCurrent: Date.parse(header) >= before - 1000 && Date.parse(header) <= Date.now() + 1000 };
};
await Bun.sleep(Number(process.argv[2]));
const first = await read();
await Bun.sleep(2100);
const second = await read();
console.log(JSON.stringify({ first, second, advanced: Date.parse(second.header) > Date.parse(first.header) }));
server.stop(true);
`,
  });
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "program"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const expected = { header: expect.any(String), isWellFormed: true, isCurrent: true };
  await Promise.all(
    ["0", "2100"].map(async delay => {
      await using proc = Bun.spawn({ cmd: [join(String(dir), isWindows ? "program.exe" : "program"), delay], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode, output: JSON.parse(stdout) }).toEqual({ stderr: "", exitCode: 0, output: { first: expected, second: expected, advanced: true } });
    }),
  );
}, 120_000);
