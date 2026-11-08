// A test may replace a built-in function before it loads a module of Bun's, and then it sees every call the module makes while it
// loads. The second text of a module (src/js/ahead-of-time), which the compiler reads, has to make the calls of the first.
import { Glob } from "bun";
import { expect } from "bun:test";
import { join } from "path";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { eachRow, gap, test } from "./supported";

const project = casesOfOneRun("a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

// A compiled test replaces only what it spells out.
const holders = {
  Object,
  Reflect,
  Symbol,
  Array,
  Number,
  Math,
  JSON,
  String,
  Promise,
  BigInt,
  Date,
  ArrayBuffer,
  Proxy,
};
const functions: string[] = [];
for (const [holder, object] of Object.entries(holders)) {
  for (const [name, { value, writable }] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
    if (typeof value === "function" && writable) functions.push(`${holder}.${name}`);
  }
}

// The modules whose second text does not make the calls of the first today. Each is asked all the same, and is red once it makes them:
// its name goes out of this list with the change that brings that about. No name comes in.
const owed: Record<string, string> = {};

function addCase(module: string) {
  return project.add(
    name => `
      import { test } from "bun:test";
      ${sayOf(name)}
      test("${name}", () => {
        const apply = Reflect.apply, ownKeys = Reflect.ownKeys, stringify = JSON.stringify;
        const describe = value => {
          if (typeof value === "function") return "function " + value.name;
          if (typeof value === "symbol") return value.toString();
          if (typeof value !== "object" || value === null) return stringify(value) ?? "undefined";
          return "{" + ownKeys(value).map(key => key.toString()).join(",") + "}";
        };
        const calls = [];
        let isWatching = false;
        const watch = (name, real) => function (...all) {
          if (isWatching) {
            isWatching = false;
            calls.push(name + "(" + all.map(describe).join(", ") + ")");
            isWatching = true;
          }
          return apply(real, this, all);
        };
        ${functions.map((path, i) => `const real${i} = ${path}; ${path} = watch("${path}", real${i});`).join("\n        ")}
        isWatching = true;
        try {
          require("${module}");
        } finally {
          isWatching = false;
          ${functions.map((path, i) => `${path} = real${i};`).join("\n          ")}
        }
        for (const call of calls) say(call);
      });`,
  );
}

function makeTheCallsOfPlainBun(modules: string[]) {
  const rows = modules.map(module => [module, addCase(module)] as const);
  eachRow(rows.map(row => (row[0] in owed ? gap(owed[row[0]], row) : row)))("%s", async (module, name) => {
    const plain = (await project.ran()).get(name)!;
    const compiled = (await project.ran(["--debug-aot"])).get(name);
    const comesToItsCalls =
      plain.result === "pass" && (plain.printed !== "") === !makeNone.includes(module) && compiled?.result === "pass";
    // Only other calls are owed: a case that does not come that far ends well, which is red.
    if (module in owed && !comesToItsCalls) return;
    expect(comesToItsCalls).toBe(true);
    expect(compiled).toEqual(plain);
  });
}

const secondTexts = [...new Glob("**/*.{js,ts}").scanSync({ cwd: join(import.meta.dir, "../../src/js/ahead-of-time") })]
  .map(file => file.replaceAll("\\", "/"))
  .sort();
const named = secondTexts
  .filter(file => file.startsWith("node/"))
  .map(file => "node:" + file.slice("node/".length, -".ts".length).replaceAll(".", "/"));

// A text that a program cannot name loads while one of these does.
const loadedWith: Record<string, string> = {
  "internal/cluster/isPrimary.ts": "node:cluster",
  "internal/http.ts": "node:http2",
  "internal/http/FakeSocket.ts": "node:_http_outgoing",
  "internal/http1_server_fallback.ts": "node:http2",
  "internal/net/isIP.ts": "node:net",
  "internal/net/symbols.ts": "node:net",
  "internal/primordials.js": "node:util",
  "internal/process/next_tick_queue.ts": "node:stream",
  "internal/readline/callbacks.ts": "node:readline",
  "internal/readline/emitKeypressEvents.ts": "node:readline",
  "internal/readline/interface.ts": "node:readline",
  "internal/readline/utils.ts": "node:readline",
  "internal/repl/node-primordials.ts": "node:repl",
  "internal/shared.ts": "node:stream",
  "internal/stream.ts": "node:stream",
  "internal/streams/destroy.ts": "node:stream",
  "internal/streams/duplex.ts": "node:stream",
  "internal/streams/end-of-stream.ts": "node:stream",
  "internal/streams/load_all.ts": "node:stream",
  "internal/streams/pipeline.ts": "node:stream",
  "internal/streams/readable.ts": "node:stream",
  "internal/streams/state.ts": "node:stream",
  "internal/streams/transform.ts": "node:stream",
  "internal/streams/utils.ts": "node:stream",
  "internal/streams/writable.ts": "node:stream",
  "internal/timers.ts": "node:net",
  "internal/trace_event_recorder.ts": "node:trace_events",
  "internal/trace_events.ts": "node:trace_events",
  "internal/validators.ts": "node:stream",
  "internal/worker/stdio.ts": "node:worker_threads",
};
// Each loads at a first use, while no module loads.
const loadedLater = [
  "internal/fs/file_handles.ts",
  "internal/fs/glob.ts",
  "internal/fs/streams.ts",
  "internal/process/tick_ring.ts",
  "internal/repl/history.ts",
  "internal/repl/node-shims.ts",
  // At the first read of WriteStream of node:tty: an-accessor-under-get-color-depth-hears-one-store.test.ts asks it.
  "internal/tty.ts",
  "internal/util/inspect.ts",
  "internal/validate_function.ts",
];
// Each loads with a module that only a flag of the command line opens.
const behindFlag = ["internal/quic/quic.ts", "internal/streams/iter/from.ts"];

// They make no call while they load.
const makeNone = ["bun:ffi", "node:trace_events"];

test("node:http has a second text", () => {
  expect(named).toContain("node:http");
});

test("every second text is asked", () => {
  // A file of builtins/ holds functions that native code calls: nothing loads it.
  const others = secondTexts.filter(file => !file.startsWith("node/") && !file.startsWith("builtins/"));
  expect(others).toEqual(["bun/ffi.ts", ...Object.keys(loadedWith), ...loadedLater, ...behindFlag].sort());
});

// node:test loads a stream with events of its own.
const asked = [...new Set([...named, ...Object.values(loadedWith), "node:test", "bun:ffi"])];
makeTheCallsOfPlainBun(asked);

test("what is owed is asked", () => {
  expect(Object.keys(owed).filter(module => !asked.includes(module))).toEqual([]);
});
