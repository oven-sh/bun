// Every test of the ahead-of-time compiler runs in some step of CI, or is listed with the reason why none can run it. The steps and what the runner picks for each come from
// scripts/aot-tests.ts, which .buildkite/ci.ts and scripts/runner.node.ts go by.
//
// Debian on x64 is told to run every file, and there the runner fails a file that runs no test (--must-run). So a new file whose tests all skip themselves on that lane is red
// until scripts/aot-tests.ts says where it runs, and this file checks that what it says holds.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import {
  aotLanes,
  getAotSample,
  getAotStepArguments,
  getAotTestsOfLane,
  getHardenedStepArguments,
  mustRunSomething,
  parseSample,
  parseStepArguments,
  pickTestsOfStep,
  spellSample,
  testsAwaitedOn,
  testsOfEngineSources,
  testsOutsideCi,
  testsThatComeInParts,
} from "../../scripts/aot-tests.ts";
import { aotTests } from "../../scripts/buildkite.ts";
import { drawsShares, rows, units, unitsThatOnlyDraw } from "./parts.mts";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// What scripts/runner.node.ts takes for a test file: getTests(), isHidden(), isTestStrict().
function* findTestFiles(folder: string): Generator<string> {
  for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (/node_modules|node.js/.test(folder) || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) yield* findTestFiles(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && /\.test|spec\./.test(entry.name)) yield path;
  }
}
const folders = [...new Set(aotTests.map(group => group.split("/")[0]))];
const tests = [...folders.flatMap(folder => [...findTestFiles(folder)]), ...units].filter(path =>
  aotTests.some(group => path.startsWith(group)),
);
const kind = {
  draws: (path: string) => drawsShares(path, read),
  onlyDraws: (path: string) => unitsThatOnlyDraw.has(path),
};

const steps = [
  ...aotLanes.flatMap(lane =>
    (["fixed", "drawn"] as const).map(takes => getAotStepArguments(lane, getAotTestsOfLane(lane, true)!, takes, false)),
  ),
  getHardenedStepArguments("fixed"),
  getHardenedStepArguments("drawn"),
].map(parseStepArguments);
const isListed = (list: string[], path: string) => list.some(group => path.includes(group));
const listedElsewhere = [...testsThatComeInParts, ...testsOfEngineSources, ...Object.keys(testsOutsideCi)];

test("every test runs in a step that fails if the test runs nothing", () => {
  const sure = new Set(
    steps.flatMap(step => pickTestsOfStep(step, tests, kind).filter(path => mustRunSomething(step, path, kind))),
  );
  // A test file that draws and has tests of its own may have nothing for one of the two steps. Both run it.
  const inBothSteps = (path: string) =>
    kind.draws(path) &&
    !kind.onlyDraws(path) &&
    steps.filter(step => step.mustRun.length && pickTestsOfStep(step, [path], kind).length).length >= 2;
  expect(tests.filter(path => !sure.has(path) && !inBothSteps(path) && !isListed(listedElsewhere, path))).toEqual([]);
});

test.each(["", "0123456789abcdef0123456789abcdef01234567", "fedcba9876543210fedcba9876543210fedcba98"])(
  "every file runs on a lane besides the two that run every file, whatever the commit %s",
  commit => {
    const drawn = new Set(
      steps
        .filter(step => step.oneIn > 1 && step.oneIn <= 8)
        .map(step => (commit ? { ...step, sample: spellSample(commit, parseSample(step.sample).share) } : step))
        .flatMap(step => pickTestsOfStep({ ...step, exclude: [] }, tests, kind)),
    );
    expect(tests.filter(path => !drawn.has(path))).toEqual([]);
  },
);

test("the sample is the commit under test, or what AOT_SAMPLE says", () => {
  const script = join(root, "..", "scripts", "aot-tests.ts");
  const sampleWith = (env: Record<string, string>) =>
    Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log((await import(${JSON.stringify(script)})).getAotSample())`],
      env: { ...bunEnv, AOT_SAMPLE: undefined, BUILDKITE: "true", ...env },
    })
      .stdout.toString()
      .trim();
  const commit = "0123456789abcdef0123456789abcdef01234567";
  expect(sampleWith({ BUILDKITE_COMMIT: commit })).toBe(commit);
  expect(sampleWith({ BUILDKITE_COMMIT: commit, AOT_SAMPLE: "89abcdef" })).toBe("89abcdef");
  // A build that is started by hand may name a branch.
  expect(sampleWith({ BUILDKITE_COMMIT: "HEAD" })).toMatch(/^[0-9a-f]{40}$/);
  expect([...new Set(steps.filter(step => step.sample).map(step => parseSample(step.sample).sample))]).toEqual([
    getAotSample(),
  ]);
});

test("no two lanes take the same tenth of a folder of programs", () => {
  expect(new Set(aotLanes.map(lane => lane.share % 10)).size).toBe(aotLanes.length);
});

test("each entry of the lists names a test", () => {
  expect(listedElsewhere.filter(group => !tests.some(path => path.includes(group)))).toEqual([]);
  expect(
    Object.values(testsAwaitedOn)
      .flat()
      .filter(group => !tests.some(path => path.includes(group))),
  ).toEqual([]);
});

test("what comes in parts has a unit", () => {
  const hasUnit = (file: string) =>
    rows.some(
      ([name, , module, callee, before = []]) =>
        name === `aot/${file}-in-parts` ||
        (module === "./servers/one-server" && `servers/${before[0]}` === file) ||
        (callee === "testOptIn" && before[2] === file),
    );
  expect(testsThatComeInParts.filter(group => !hasUnit(group.replace(/^aot\/|\.test$/g, "")))).toEqual([]);
});

test("what reads the engine's sources is what the workflow runs", () => {
  const helper = ["harness", "engine-text"].join("/");
  const files = readdirSync(import.meta.dir).filter(
    name => name.endsWith(".test.ts") && read(`aot/${name}`).includes(`from "./${helper}"`),
  );
  expect(files.map(name => `aot/${name.replace(/\.ts$/, "")}`).sort()).toEqual([...testsOfEngineSources].sort());
  expect(readFileSync(join(root, "..", ".github", "workflows", "lint.yml"), "utf8")).toContain(
    `files=$(grep -l "${helper}" test/aot/*.test.ts)\n`,
  );
});
