import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

// The JavaScript behind the channel of `process` (it restores Buffers and passes handles) is in an executable whose program calls
// process.on("message", ..) where the compiler can see that the call is on `process`, calls what process.send or process.disconnect
// holds, or names Bun.spawn. The parent here is the test, so nothing but the child's own code decides.
const listens = (self: string) => `
const self = ${self};
self.on(["mess", "age"].join(""), message => {
  console.log("child got", message.text, Buffer.isBuffer(message.bytes), message.bytes.length);
  setTimeout(() => self.exit(0), 10);
});
`;

const startWithChannel = (name: string, self: string) => startProgramWithChannel(name, listens(self));

async function startProgramWithChannel(name: string, program: string) {
  using dir = tempDir(`channel-of-process-${name}`, { "child.js": program });
  const executable = join(String(dir), isWindows ? "child.exe" : "child");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "child.js", "--outfile", executable],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });

  await using child = Bun.spawn({
    cmd: [executable],
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    serialization: "advanced",
    ipc(message) {
      if (message.text === "from the child") child.send({ text: "answer", bytes: message.bytes });
    },
  });
  child.send({ text: "hello", bytes: Buffer.from([1, 2, 3]) });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, error: stderr.split("\n").find(line => line.startsWith("error: ")) ?? "", exitCode };
}

const received = { stdout: "child got hello true 3\n", error: "", exitCode: 0 };

test.concurrent.each([["another-variable", "[process][process.argv.length - process.argv.length]"]])(
  "the channel works where the receiver of the call lists process: %s",
  async (name, self) => {
    expect(await startWithChannel(name, self)).toEqual(received);
  },
  120_000,
);

// What `reason` answers is any value to the compiler, and `process` has gone into a built-in that keeps it.
test("the channel works where process comes back out of a built-in that kept it", async () => {
  expect(await startWithChannel("kept", "AbortSignal.abort(process).reason")).toEqual(received);
}, 120_000);

// Nothing but the call says that the program has a channel: it has no listener when the first message arrives.
test("the channel works where the function that process.send holds is called by value", async () => {
  const sends = `
const { send } = process;
send({ text: "from the child", bytes: Buffer.from([1, 2, 3, 4]) });
setTimeout(() => {
  const self = [process][process.argv.length - process.argv.length];
  console.log("child sent", self.connected);
  self.exit(0);
}, 200);
`;
  expect(await startProgramWithChannel("sends", sends)).toEqual({
    stdout: "child sent true\n",
    error: "",
    exitCode: 0,
  });
}, 120_000);

// What text put together at run time answers is any value to the compiler. It does not take a method called on such a value for one of `process`.
test("a listener added through a value that the compiler can't follow leaves the channel's JavaScript out, and the error says so", async () => {
  expect(await startWithChannel("lost", `(0, eval)(["pro", "cess"].join(""))`)).toEqual({
    stdout: "",
    error:
      "error: Bun.spawn was not compiled into this executable because your code never uses it. " +
      "To keep it, use it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)",
    exitCode: 1,
  });
}, 120_000);
