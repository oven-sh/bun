// harness/every-build.ts says what runs where, and why.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { everyBuild, isLeftOut } from "./harness/every-build";
import { run } from "./harness/run";

raiseDefaultTimeout(120_000);

test("the list names files that are there, in order", () => {
  const paths = [...everyBuild.keys()];
  expect(paths.filter(path => !existsSync(join(import.meta.dir, "..", path)))).toEqual([]);
  expect(paths).toEqual([...new Set(paths)].sort());
  expect([...everyBuild].filter(([, seconds]) => !(seconds > 0))).toEqual([]);
});

// About a minute for each of the twenty jobs of a lane. Whoever puts a file on the list takes another one off, or makes one cheaper.
test("what CI runs for every build takes no more than fifty minutes of one processor", () => {
  expect([...everyBuild.values()].reduce((sum, seconds) => sum + seconds, 0)).toBeLessThanOrEqual(3_000);
});

test("the list counts where it is asked for alone", () => {
  const [listed] = everyBuild.keys();
  expect([true, false].map(alone => isLeftOut(listed, alone))).toEqual([false, false]);
  expect([true, false].map(alone => isLeftOut("aot/no-such.test.ts", alone))).toEqual([true, false]);
});

// ./every-build/*.fixture.ts: every form in which a file of this folder declares something: out of ./supported (a, b), ./listed (c) and harness/default-timeout.ts (d).
const fixtures = ["a", "b", "c", "d"].map(name => `./aot/every-build/${name}.fixture.ts`);

async function runForms(whole: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, AOT_WHOLE: whole, AOT_WHOLE_GRIDS: undefined, BUILDKITE_BUILD_NUMBER: undefined };
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags, ...fixtures], join(import.meta.dir, ".."), env);
  const count = (word: string) => Number(new RegExp(`^ *(\\d+) ${word}$`, "m").exec(stderr)?.[1] ?? 0);
  const ran = stderr.split("\n").filter(line => line.startsWith("RAN ")).length;
  return { ran, exitCode, pass: count("pass"), skip: count("skip"), fail: count("fail") };
}

test("a file that the list lacks declares one skipped test, and nothing of it runs", async () => {
  for (const flags of [[], ["--parallel"], ["--isolate"]])
    expect({ flags, ...(await runForms("0", ...flags)) }).toEqual({
      flags,
      ran: 0,
      exitCode: 0,
      pass: 0,
      skip: 4,
      fail: 0,
    });
});

test("it runs where everything is asked for, and where nothing is said", async () => {
  const all = await runForms("1");
  expect(all).toMatchObject({ exitCode: 0, fail: 0, skip: 2 });
  expect(all.pass).toBeGreaterThan(40);
  expect(all.ran).toBeGreaterThan(60);
  expect(await runForms(undefined)).toEqual(all);
});

test("what a test writes into a temporary folder and starts is left out nowhere", async () => {
  using dir = tempDir("aot-every-build", {
    "a.test.ts": `import { test } from ${JSON.stringify(join(import.meta.dir, "supported.ts"))};\ntest("it runs", () => {});\n`,
    "b.test.ts": `import { test } from ${JSON.stringify(join(import.meta.dir, "listed.ts"))};\ntest("it runs", () => {});\n`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "./a.test.ts", "./b.test.ts"], String(dir), {
    ...bunEnv,
    AOT_WHOLE: "0",
  });
  expect({ exitCode, counts: stderr.match(/^ *\d+ (?:pass|skip|fail)$/gm)?.map(line => line.trim()) }).toEqual({
    exitCode: 0,
    counts: ["2 pass", "0 fail"],
  });
});

// A lane that runs a few files by name runs nothing of a file that the list lacks.
test("what a lane of CI names by itself is on the list", () => {
  const pipeline = join(import.meta.dir, "..", "..", ".buildkite", "ci.ts");
  const named = [...readFileSync(pipeline, "utf8").matchAll(/^ +tests: \[([^\]]*)\]/gm)].flatMap(([, names]) =>
    [...names.matchAll(/"(aot\/[^"]+)"/g)].map(([, name]) => name),
  );
  expect(named.length).toBeGreaterThan(0);
  const testFiles = readdirSync(import.meta.dir, { recursive: true, encoding: "utf8" })
    .map(path => `aot/${path.replaceAll("\\", "/")}`)
    .filter(path => /\.test\.ts$/.test(path) && !path.includes("/node_modules/"));
  expect(testFiles.filter(path => named.some(name => path.startsWith(name)) && !everyBuild.has(path))).toEqual([]);
});

// What a file takes straight from bun:test declares its tests and runs its hooks wherever the file is loaded.
const askByThemselves = new Set([
  "aot/harness/default-timeout.ts",
  "aot/harness/left-out.ts",
  "aot/listed.ts",
  // For tests that are skipped with a sanitizer.
  "aot/harness/runner-suites.ts",
  "aot/measures.ts",
]);
const folderOfTests = join(import.meta.dir, "..");
const looked = new Map<string, { takes: boolean; imports: string[] }>();
function lookAt(path: string) {
  if (looked.has(path)) return looked.get(path)!;
  // Behind the first statement that imports nothing may stand the text of another test file.
  const [head] = /^(?:(?:import\b[^;]*;|\/\/.*|\/\*[^]*?\*\/)?[ \t]*\n)*/.exec(
    readFileSync(join(folderOfTests, path), "utf8"),
  )!;
  const statements = head.replace(/\/\/.*|\/\*[^]*?\*\//g, "");
  const names = [...statements.matchAll(/import\s*\{([^}]*)\}\s*from\s*"bun:test"/g)].map(([, taken]) => taken).join();
  const imports = [...statements.matchAll(/(?:from|import)\s*"(\.[^"]+)"/g)].flatMap(([, to]) => {
    const base = join(dirname(path), to).replaceAll("\\", "/");
    const isFile = (it: string) => existsSync(join(folderOfTests, it)) && statSync(join(folderOfTests, it)).isFile();
    return base.startsWith("..")
      ? []
      : [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].filter(isFile).slice(0, 1);
  });
  const takes = !askByThemselves.has(path) && /(?:^|,)\s*(?:test|it|beforeAll|beforeEach)\b/.test(names);
  looked.set(path, { takes, imports });
  return looked.get(path)!;
}

test("a file that the list lacks takes test, it, beforeAll and beforeEach from ./listed or ./supported, not from bun:test", () => {
  const leftOut = readdirSync(import.meta.dir, { recursive: true, encoding: "utf8" })
    .map(path => `aot/${path.replaceAll("\\", "/")}`)
    .filter(path => /\.test\.(?:ts|tsx|js|mjs|cjs)$/.test(path) && !everyBuild.has(path))
    .filter(path => !/\/(?:node_modules|parallel|programs|fixtures?)\//.test(path));
  const found = leftOut.sort().flatMap(file => {
    const reached = [file];
    for (const path of reached) reached.push(...lookAt(path).imports.filter(it => !reached.includes(it)));
    return reached.filter(path => lookAt(path).takes).map(path => (path === file ? file : `${file}, through ${path}`));
  });
  expect(found).toEqual([]);
});

test("what CI says of a build becomes AOT_WHOLE", async () => {
  using dir = tempDir("aot-every-build", {
    "say.ts": `import ${JSON.stringify(join(import.meta.dir, "harness", "every-build.ts"))};\nconsole.log(String(process.env.AOT_WHOLE));`,
  });
  const nothingSaid = { ...bunEnv, AOT_WHOLE: undefined, AOT_WHOLE_GRIDS: undefined };
  const said = async (step: Record<string, string>) =>
    (await run([bunExe(), "say.ts"], String(dir), { ...nothingSaid, ...step })).stdout.trim();
  expect(await said({})).toBe("undefined");
  expect(await said({ BUILDKITE_BUILD_NUMBER: "136420", BUILDKITE_MESSAGE: "a change" })).toBe("0");
  expect(await said({ BUILDKITE_BUILD_NUMBER: "136420" })).toBe("0");
  expect(await said({ BUILDKITE_BUILD_NUMBER: "136420", BUILDKITE_MESSAGE: "a change\n\n[aot whole]" })).toBe("1");
  expect(await said({ BUILDKITE_BUILD_NUMBER: "136420", AOT_WHOLE: "1" })).toBe("1");
});
