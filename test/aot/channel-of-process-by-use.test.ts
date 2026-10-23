import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

// The JavaScript behind the channel of `process` (it restores Buffers and passes handles) is in an executable whose program calls
// process.on("message", ..) where the compiler can see that the call is on `process`, or names process.send, process.channel,
// process.disconnect or Bun.spawn. The parent here is the test, so nothing but the child's own code decides.
const listens = (self: string) => `
const self = ${self};
self.on(["mess", "age"].join(""), message => {
  console.log("child got", message.text, Buffer.isBuffer(message.bytes), message.bytes.length);
  setTimeout(() => self.exit(0), 10);
});
`;

async function startWithChannel(name: string, self: string) {
  using dir = tempDir(`channel-of-process-${name}`, { "child.js": listens(self) });
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
    ipc() {},
  });
  child.send({ text: "hello", bytes: Buffer.from([1, 2, 3]) });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, error: stderr.split("\n").find(line => line.startsWith("error: ")) ?? "", exitCode };
}

const received = { stdout: "child got hello true 3\n", error: "", exitCode: 0 };

test.concurrent.each([
  ["named", "process"],
  ["another-variable", "[process][process.argv.length - process.argv.length]"],
  ["parameter", "(emitter => emitter)(process)"],
  ["weak-reference", "new WeakRef(process).deref()"],
])(
  "the channel works where the receiver of the call lists process: %s",
  async (name, self) => {
    expect(await startWithChannel(name, self)).toEqual(received);
  },
  120_000,
);

// What comes out of `cause` is any value to the compiler. It does not take a method called on such a value for one of `process`.
test("a listener added through a value that the compiler can't follow leaves the channel's JavaScript out, and the error says so", async () => {
  expect(await startWithChannel("lost", `new Error("holder", { cause: process }).cause`)).toEqual({
    stdout: "",
    error:
      "error: None of Bun.spawn, process.channel, process.disconnect or process.send was compiled into this executable because your code never uses them. " +
      "To keep them, use one of them somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/bundler/aot-compatibility)",
    exitCode: 1,
  });
}, 120_000);
