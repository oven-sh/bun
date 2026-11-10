import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { limitOfARun, limitWithASAN } from "./harness/commands";
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

type Message = { text: string; bytes: Uint8Array };

// bun:test ends the children of a test that timed out only where that test ran alone, so a command that hangs is ended here: the signal fails its test.
const limitOfACommand = isASAN || isDebug ? limitWithASAN : limitOfARun;

async function startProgramWithChannel(name: string, program: string) {
  using dir = tempDir(`channel-of-process-${name}`, { "child.js": program });
  const executable = join(String(dir), isWindows ? "child.exe" : "child");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "child.js", "--outfile", executable],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    timeout: limitOfACommand,
    killSignal: "SIGKILL",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });

  const fromChild: Message[] = [];
  await using child = Bun.spawn({
    cmd: [executable],
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    serialization: "advanced",
    timeout: limitOfACommand,
    killSignal: "SIGKILL",
    ipc(message: Message) {
      fromChild.push(message);
      if (message.text !== "from the child") return;
      child.send({ text: "answer", bytes: message.bytes });
      child.disconnect();
    },
  });
  child.send({ text: "hello", bytes: Buffer.from([1, 2, 3]) });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return {
    stdout,
    stderr: normalizeBunSnapshot(stderr),
    exitCode,
    signalCode: child.signalCode,
    // toEqual() takes a Uint8Array for a Buffer, so each message says which of the two its bytes arrived as.
    parentGot: fromChild.map(({ text, bytes }) => ({ text, isBuffer: Buffer.isBuffer(bytes), bytes: [...bytes] })),
  };
}

const received = { stdout: "child got hello true 3\n", stderr: "", exitCode: 0, signalCode: null, parentGot: [] };

test.concurrent.each([["another-variable", "[process][process.argv.length - process.argv.length]"]])(
  "the channel works where the receiver of the call lists process: %s",
  async (name, self) => {
    expect(await startWithChannel(name, self)).toEqual(received);
  },
);

// What `reason` answers is any value to the compiler, and `process` has gone into a built-in that keeps it.
test.concurrent("the channel works where process comes back out of a built-in that kept it", async () => {
  expect(await startWithChannel("kept", "AbortSignal.abort(process).reason")).toEqual(received);
});

// Nothing but the call says that the program has a channel: no listener takes the first message or the answer, and both are read.
// The parent closes the channel behind its answer, and the child waits until it finds the channel closed.
test.concurrent("the channel works where the function that process.send holds is called by value", async () => {
  const sends = `
const { send } = process;
send({ text: "from the child", bytes: Buffer.from([1, 2, 3, 4]) });
const self = [process][process.argv.length - process.argv.length];
console.log("child sent", self.connected);
setInterval(() => {
  if (self.connected) return;
  console.log("child disconnected");
  self.exit(0);
}, 1);
`;
  expect(await startProgramWithChannel("sends", sends)).toEqual({
    stdout: "child sent true\nchild disconnected\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
    parentGot: [{ text: "from the child", isBuffer: true, bytes: [1, 2, 3, 4] }],
  });
});

// What text put together at run time answers is any value to the compiler. It does not take a method called on such a value for one of `process`.
test.concurrent(
  "a listener added through a value that the compiler can't follow leaves the channel's JavaScript out, and the error says so",
  async () => {
    expect(await startWithChannel("lost", `(0, eval)(["pro", JSON.parse('"cess"')].join(""))`)).toEqual({
      stdout: "",
      stderr:
        "error: Bun.spawn was not compiled into this executable because your code never uses it. " +
        "To keep it, use it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)" +
        "\n\nBun v<bun-version>",
      exitCode: 1,
      signalCode: null,
      parentGot: [],
    });
  },
);
