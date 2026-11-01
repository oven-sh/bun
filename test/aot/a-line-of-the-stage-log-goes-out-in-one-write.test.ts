// Bun and the engine write to one descriptor under no common lock: a line that goes out in pieces can have another line in its middle.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, shellExe, tempDir } from "harness";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { buildEnvironment, withThreads } from "./harness/flags";
import { test } from "./supported";

// A datagram socket hands over what one write wrote, whatever the kernel, the processor or the container. The shell opens one as the standard error of what it runs.
const toDatagramsAt = (port: number) => `/dev/udp/127.0.0.1/${port}`;
const shellOpensDatagramSockets =
  isLinux &&
  Bun.which(shellExe()) !== null &&
  Bun.spawnSync({ cmd: [shellExe(), "-c", `: 2> ${toDatagramsAt(9)}`], stderr: "ignore" }).exitCode === 0;

if (isLinux && !shellOpensDatagramSockets)
  test.skip(`the shell of this machine opens no ${toDatagramsAt(9)}`, () => {});

// Row 4086: with glibc 2.37 or newer the long lines of the engine still go out in pieces. The running system says which it has.
const { glibcVersionRuntime } = (process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header;
const [major = 0, minor = 0] = glibcVersionRuntime?.split(".").map(Number) ?? [];
const isNotMetYet = major > 2 || (major === 2 && minor >= 37);

const one = !shellOpensDatagramSockets ? test.skip : isNotMetYet ? test.todo : test;
one("the lines that tools read are one write each", async () => {
  using dir = tempDir("aot-a-line-is-one-write", {
    "program.js": `function double(value) { return value * 2; }\nconsole.log(double(21));\n`,
  });
  const writes: string[] = [];
  const listener = createSocket("udp4");
  try {
    listener.on("message", message => writes.push(message.toString("utf8")));
    listener.bind(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address();
    const build = Bun.spawn({
      cmd: [
        ...[shellExe(), "-c", `exec 2> ${toDatagramsAt(port)} && exec "$@"`, shellExe()],
        ...[bunExe(), "build", "--compile", "--aot", withThreads(4), "program.js", "--outfile", "program"],
      ],
      cwd: String(dir),
      env: { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await build.exited).toBe(0);
    // What was sent earlier has arrived earlier.
    const last = "the build has ended";
    listener.send(last, port, "127.0.0.1");
    while (writes.at(-1) !== last) await once(listener, "message");
  } finally {
    listener.close();
  }

  const ofEngine = /^AOT parallel loops: |^AOT phase times: (?!front end \|)/;
  const begun = writes.filter(text => ofEngine.test(text));
  expect(begun.filter(text => text.startsWith("AOT parallel loops: ")).length).toBeGreaterThan(0);
  expect(begun.filter(text => text.startsWith("AOT phase times: ")).length).toBeGreaterThan(0);
  expect(begun.filter(text => !text.endsWith("\n"))).toEqual([]);
});
