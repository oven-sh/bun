// Built-in JavaScript reads properties by keys that the compiler does not see. Where every such place of a file has been read and
// shown to be harmless, src/codegen/builtins-manifest.ts vouches for the file. The compiler says how many places each voucher stands
// for. A number that differs here means that a place was added or removed: read the new place as the others were read (can the key
// be a name the program chose, and can the receiver be anything but the file's own table?), then change the number.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

const program = `declare const require: any, console: any;
console.log(require("node:http"), require("node:https"), require("node:child_process"), require("node:readline/promises"), require("node:util"));`;

const places: Record<string, Record<string, number>> = {
  "internal/cluster/RoundRobinHandle.ts": { "finds Function": 1, "property *": 1 },
  "internal/cluster/child.ts": { "finds Function": 1, "property *": 2 },
  "internal/cluster/primary.ts": { "finds Function": 3, "property *": 3 },
  "internal/fifo.ts": { "finds Function": 3, "property *": 3 },
  "internal/fixed_queue.ts": { "finds Function": 1, "property *": 1 },
  "internal/fs/cp-sync.ts": { "property *": 1 },
  "internal/fs/glob.ts": { "finds Function": 9, "property *": 11 },
  "internal/fs/streams.ts": { "finds Function": 4, "property *": 4 },
  "internal/http/FakeSocket.ts": { "property *": 1 },
  "internal/http1_server_fallback.ts": { "finds Function": 2, "property *": 3 },
  "internal/primordials.js": { "finds Function": 2, "property *": 5 },
  "internal/promisify.ts": { "finds Function": 2, "property *": 2 },
  "internal/readline/interface.js": { "finds Function": 5, "property *": 7 },
  "internal/repl/history.js": { "finds Function": 1, "property *": 1 },
  "internal/repl/node-primordials.js": { "finds Function": 1, "property *": 1 },
  "internal/serialization_buffers.ts": { "finds Function": 1, "property *": 1 },
  "internal/shared.ts": { "property *": 1 },
  "internal/stream.ts": { "finds Function": 1, "property *": 1 },
  "internal/streams/duplex.ts": { "finds Function": 2, "property *": 2 },
  "internal/streams/fast-utf8-stream.ts": { "finds Function": 1, "property *": 1 },
  "internal/streams/iter/classic.ts": { "finds Function": 5, "property *": 6 },
  "internal/streams/iter/from.ts": { "finds Function": 4, "property *": 5 },
  "internal/streams/iter/pull.ts": { "finds Function": 2, "property *": 5 },
  "internal/streams/iter/utils.ts": { "property *": 1 },
  "internal/streams/lazy_transform.ts": { "finds Function": 1, "property *": 1 },
  "internal/streams/legacy.ts": { "finds Function": 2 },
  "internal/streams/readable.ts": { "finds Function": 1, "property *": 1 },
  "internal/streams/state.ts": { "finds Function": 1, "property *": 1 },
  "internal/streams/writable.ts": { "property *": 1 },
  "internal/tls.ts": { "finds Function": 1, "property *": 1 },
  "internal/tty.ts": { "finds Function": 1, "property *": 1 },
  "internal/util/inspect.ts": { "finds Function": 6, "property *": 9 },
  "node/_http_agent.ts": { "finds Function": 8, "property *": 9 },
  "node/_http_client.ts": { "finds Function": 2, "property *": 2 },
  "node/_http_common.ts": { "finds Function": 1, "property *": 1 },
  "node/_http_incoming.ts": { "finds Function": 2, "property *": 4 },
  "node/_http_outgoing.ts": { "finds Function": 8, "property *": 13 },
  "node/_http_server.ts": { "finds Function": 6, "property *": 7 },
  "node/child_process.ts": { "finds Function": 6, "property *": 6 },
  "node/crypto.ts": { "finds Function": 1, "property *": 1 },
  "node/dgram.ts": { "finds Function": 3, "property *": 4 },
  "node/diagnostics_channel.ts": { "finds Function": 2, "property *": 2 },
  "node/events.ts": { "finds Function": 8 },
  "node/https.ts": { "finds Function": 1, "property *": 3 },
  "node/net.ts": { "finds Function": 10, "property *": 14 },
  "node/os.ts": { "finds Function": 2, "property *": 2 },
  "node/readline.js": { "finds Function": 15, "property *": 15 },
  "node/readline.promises.js": { "finds Function": 3, "property *": 3 },
  "node/tls.ts": { "finds Function": 3, "property *": 4 },
  "node/util.ts": { "finds Function": 6, "property *": 8 },
};

test("every place that a voucher stands for has been read", async () => {
  using dir = tempDir("aot-places-vouched-for", { "tsconfig.json": tsconfig, "main.ts": program });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const found: Record<string, Record<string, number>> = {};
  for (const line of stderr.split("\n").sort()) {
    const [, fact, file, count] = /^aot: runtime use: vouched (.+) \/\$bun\/js\/((?:internal|node)\/\S+) (\d+)$/.exec(line) ?? [];
    if (file) (found[file.toLowerCase()] ??= {})[fact] = Number(count);
  }
  expect({ exitCode, found }).toEqual({ exitCode: 0, found: Object.fromEntries(Object.entries(places).map(([file, counts]) => [file.toLowerCase(), counts])) });
});
