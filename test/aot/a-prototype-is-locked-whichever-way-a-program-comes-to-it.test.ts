import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(240_000);

// The build takes a read of AbortSignal.prototype.throwIfAborted for a constant, so a compiled program may not change the member: the change throws. The prototype object
// is the same whichever way a program comes to it, so the answer has to be the same too. Native code makes the object with the first instance, and a program has
// instances of classes whose names it never reads: the signal of an AbortController, the writable end of a TransformStream, the controller of a byte stream. The global
// object adds the constructor only at the first read of the name.
const members = [
  {
    member: "AbortSignal.prototype.throwIfAborted",
    instance: `new AbortController().signal`,
    steps: 1,
    original: "undefined",
  },
  {
    member: "EventTarget.prototype.addEventListener",
    instance: `new AbortController().signal`,
    steps: 2,
    operands: `, "abort", () => {}`,
    original: "undefined",
  },
  {
    member: "Event.prototype.preventDefault",
    instance: `new CustomEvent("made")`,
    steps: 2,
    original: "undefined",
  },
  {
    member: "WritableStream.prototype.getWriter",
    instance: `new TransformStream().writable`,
    steps: 1,
    original: "[object WritableStreamDefaultWriter]",
  },
  {
    member: "ReadableByteStreamController.prototype.close",
    instance: `(() => { let made; new ReadableStream({ type: "bytes", start(controller) { made = controller; } }); return made; })()`,
    steps: 1,
    original: "undefined",
  },
  {
    member: "ReadableStreamBYOBReader.prototype.releaseLock",
    instance: `new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" })`,
    steps: 1,
    original: "undefined",
  },
];
const ways: [string, string][] = [
  ["through an instance", ``],
  [
    "behind a read of the name of the class",
    `globalThis.kept = [${members.map(({ member }) => member.split(".")[0]).join(", ")}];\n`,
  ],
];

// The build follows neither the object nor the name through the event, so it sees no change of a member, and the read of the member by its name stays a constant.
// That read reads the name of the class, so every change comes ahead of the first of them. A member is a number here: a test run takes a string that spells out a
// member for the name of what a test replaces, and leaves that member open.
const body = `const hide = value => new CustomEvent("hidden", { detail: value }).detail;
const found = {};
function attempt(what, change) {
  try { found[what] = String(change()); } catch (error) { found[what] = error.constructor.name + ": " + error.message.split(/,| \\(/)[0]; }
}
${members
  .map(
    ({ member, instance, steps }, row) => `{
  let holder = hide(${instance});
  for (let step = 0; step < ${steps}; step++) holder = Object.getPrototypeOf(holder);
  const name = hide(${JSON.stringify(member.split(".")[2])});
  attempt("delete ${row}", () => delete holder[name]);
  attempt("store to ${row}", () => ((holder[name] = function () { return "replaced"; }), "stored"));
  attempt("define ${row}", () => (Object.defineProperty(holder, name, { value: function () { return "replaced"; } }), "defined"));
}`,
  )
  .join("\n")}
${members
  .map(
    ({ member, instance, operands = "" }, row) =>
      `attempt("call ${row}", () => ${member}.call(${instance}${operands}));`,
  )
  .join("\n")}
console.log("ANSWER " + JSON.stringify(found));
`;
const files = Object.fromEntries(
  ways.flatMap(([, head], way) => [
    [`${way}.mjs`, `${head}${body}`],
    [`${way}.test.mjs`, `import { test } from "bun:test";\n${head}test("every change", () => {\n${body}});\n`],
  ]),
);
files["worker.mjs"] = body;
files["starts-a-worker.mjs"] = `const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
await new Promise(resolve => worker.addEventListener("close", resolve));
`;

/** What a program answers, with the name of each member in the place of its number. */
function answerIn(stdout: string) {
  const answer = /^ANSWER (.*)$/m.exec(stdout)?.[1];
  if (!answer) return `no answer in ${JSON.stringify(stdout)}`;
  const found = Object.entries(JSON.parse(answer) as Record<string, string>);
  return Object.fromEntries(found.map(([what, how]) => [what.replace(/\d+$/, row => members[+row].member), how]));
}
/** What each way answers. */
async function answers(outputOf: (file: string) => Promise<string>) {
  const all = await Promise.all(ways.map((_, way) => slot(() => outputOf(String(way)))));
  return Object.fromEntries(ways.map(([way], index) => [way, answerIn(all[index])]));
}
const everyWay = (answer: Record<string, string>) => Object.fromEntries(ways.map(([way]) => [way, answer]));
const refused = (where: string) =>
  Object.fromEntries(
    members.flatMap(({ member, original }) => [
      [`delete ${member}`, `TypeError: Cannot delete ${member} because built-in objects are read-only in ${where}`],
      [
        `store to ${member}`,
        `TypeError: Cannot assign to ${member} because built-in objects are read-only in ${where}`,
      ],
      [`define ${member}`, `TypeError: Cannot assign to ${member} because built-in objects are read-only in ${where}`],
      [`call ${member}`, original],
    ]),
  );

test.concurrent("in plain Bun every way changes the members", async () => {
  using directory = tempDir("prototype-by-every-way-plain", files);
  const found = await answers(
    async file => (await run([bunExe(), "run", `./${file}.mjs`], String(directory), bunEnv)).stdout,
  );
  expect(found).toEqual(
    everyWay(
      Object.fromEntries(
        members.flatMap(({ member }) => [
          [`delete ${member}`, "true"],
          [`store to ${member}`, "stored"],
          [`define ${member}`, "defined"],
          [`call ${member}`, "replaced"],
        ]),
      ),
    ),
  );
});

test.concurrent("in an executable every way is refused", async () => {
  using directory = tempDir("prototype-by-every-way-executable", files);
  const runCompiled = async (file: string, ...more: string[]) => {
    const executable = join(String(directory), file + (isWindows ? ".exe" : ".out"));
    const build = [bunExe(), "build", "--compile", "--aot", `./${file}.mjs`, ...more, "--outfile", executable];
    expect(await run(build, String(directory), bunEnv)).toMatchObject({ exitCode: 0 });
    return (await run([executable], String(directory), bunEnv)).stdout;
  };
  expect(await answers(file => runCompiled(file))).toEqual(everyWay(refused("a compiled executable")));
  expect(answerIn(await slot(() => runCompiled("starts-a-worker", "./worker.mjs")))).toEqual(
    refused("a compiled executable"),
  );
});

// A debug build takes minutes to compile Bun's library into layers.
if (isDebug)
  console.error(
    "SKIPPED: test/aot/a-prototype-is-locked-whichever-way-a-program-comes-to-it.test.ts: the test run over two layers, in a debug build of Bun",
  );
for (const [form, words, isSkipped] of [
  ["as one program", "TestRunLayers:0", false],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1", isDebug],
] as const)
  test.skipIf(isSkipped).concurrent(`in a test run ${form} every way is refused`, async () => {
    using directory = tempDir("prototype-by-every-way-test-run", files);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const found = await answers(
      async file => (await run([bunExe(), "test", "--aot", `./${file}.test.mjs`], String(directory), env)).stdout,
    );
    expect(found).toEqual(everyWay(refused("compiled code")));
  });
