// A prototype object holds its constructor. Where a program gets a value from native code which the compiler knows nothing about, every prototype object counts as let go,
// and each let its constructor go with it: Bun.Transpiler, and with it the interpreter and the text of the built-in functions, Bun.Archive, HTMLRewriter ..
// But that road starts at an instance. A constructor that no statement names or hands on, on a holder that is let go nowhere, is come to through an instance alone, and
// whoever makes an instance is listed with the features of the class: so the constructor keeps none of them. Where code can run that the compiler does not see, nothing of this holds.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ofConstructorsThatNobodyComesTo = [
  "Bun.Transpiler and the transpiler for code loaded at run time (interpreter)",
  "eval, new Function and the JavaScript interpreter (interpreter)",
  "the source code of built-in functions (interpreter)",
  "Bun.Archive (archive)",
  "Bun.redis and Bun.RedisClient (redis)",
  "Bun.FileSystemRouter (fs-router)",
  "HTMLRewriter (html-rewriter)",
];

const aValueThatNobodyKnows = `
const harbor = new WebSocket("ws://localhost:1");
harbor.onerror = () => console.log("no harbor");
harbor.onmessage = letter => console.log(letter.data.scan("cargo"));
`;
const programs = {
  "a method is called on a value that native code hands over": aValueThatNobodyKnows,
  "a server of node:http says hello": `
import { createServer } from "node:http";
const server = createServer((request, response) => response.end(request.url));
server.listen(0, () => server.close());
`,
  "a statement names a constructor beside it": `${aValueThatNobodyKnows}console.log(typeof new Bun.Transpiler().scan);\n`,
  "a statement hands a constructor on beside it": `${aValueThatNobodyKnows}const held = [HTMLRewriter];\nconsole.log(typeof held[process.argv.length]);\n`,
  "Bun is read under a key of run time beside it": `${aValueThatNobodyKnows}console.log(typeof Bun[process.argv[2]]);\n`,
  "machine code is loaded beside it": `${aValueThatNobodyKnows}process.dlopen({ exports: {} }, process.argv[2]);\n`,
  "a worker is started without a name beside it": `${aValueThatNobodyKnows}new Worker(process.argv[2]);\n`,
};

async function featuresKeptBy(text: string) {
  using dir = tempDir("aot-features-of-constructors", { "main.mjs": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return [...stderr.matchAll(/^aot: trim: kept (.+): used/gm)].map(line => line[1]);
}

// All the programs are checked side by side, once the first case asks.
let checked: Map<string, Promise<string[]>> | undefined;
const keptBy = (title: keyof typeof programs) =>
  (checked ??= new Map(Object.entries(programs).map(([each, text]) => [each, featuresKeptBy(text)]))).get(title)!;

for (const title of [
  "a method is called on a value that native code hands over",
  "a server of node:http says hello",
] as const) {
  test(`${title}: no constructor that nobody comes to keeps a feature`, async () => {
    const kept = await keptBy(title);
    expect(kept).not.toBeEmpty();
    expect(kept.filter(feature => ofConstructorsThatNobodyComesTo.includes(feature))).toEqual([]);
  }, 600_000);
}

for (const title of ["machine code is loaded beside it", "a worker is started without a name beside it"] as const) {
  test(`${title}: every constructor keeps its features`, async () => {
    const kept = await keptBy(title);
    expect(kept).toContain("Bun.Archive (archive)");
    expect(kept).toContain("HTMLRewriter (html-rewriter)");
  }, 600_000);
}

test("a constructor that a statement names keeps its features", async () => {
  expect(await keptBy("a statement names a constructor beside it")).toContain(ofConstructorsThatNobodyComesTo[0]);
}, 600_000);

test("a constructor that a statement hands on keeps its features", async () => {
  expect(await keptBy("a statement hands a constructor on beside it")).toContain("HTMLRewriter (html-rewriter)");
}, 600_000);

test("every constructor on a holder that is read under a key of run time keeps its features", async () => {
  const kept = await keptBy("Bun is read under a key of run time beside it");
  expect(kept).toContain("Bun.Archive (archive)");
  expect(kept).toContain("Bun.FileSystemRouter (fs-router)");
  expect(kept).toContain(ofConstructorsThatNobodyComesTo[0]);
}, 600_000);
