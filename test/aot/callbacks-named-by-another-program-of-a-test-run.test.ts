import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const givesNames = `const handedBack = new Function("f", "return f");
export const shownAs = (render, name) => { handedBack(render).displayName = name; return render; };
export const called = (render, name) => { Object.defineProperty(handedBack(render), "name", { value: name }); return render; };
`;

const programs = ["the package", "the application", "the test file"] as const;

const filesWithNamesGivenIn = (where: (typeof programs)[number]): Record<string, string> => ({
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "node_modules/walks/package.json": `{ "name": "walks", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
  "node_modules/walks/index.js": `${where === "the package" ? givesNames : ""}const handedOnByText = new Function("f", "return f");
export const handedOn = render => handedOnByText(render);
export const forEachOf = (list, each) => {
  const inThePackage = function inThePackage(item) { return [...each(item)]; };
  return { found: list.flatMap(handedOnByText(inThePackage)), inThePackage };
};
`,
  "src/work.js": `${where === "the application" ? givesNames : ""}import { forEachOf, handedOn } from "walks";
const step = (path, visit) => visit(path) + 1;
export function work(list, probe, k) {
  const visit = handedOn(function visit(path) { return probe(path + k) + 1; });
  const each = function each(path) { return [step(path, visit)]; };
  const { found, inThePackage } = forEachOf(list, each);
  return { result: found.length, visit, each, inThePackage };
}
`,
  "a.test.js": `import { expect, test } from "bun:test";
import { handedOn } from "walks";
import { work } from "./src/work.js";
${
  {
    "the package": `import { called, shownAs } from "walks";`,
    "the application": `import { called, shownAs } from "./src/work.js";`,
    "the test file": givesNames.replaceAll("export ", ""),
  }[where]
}
const names = error => String(error.stack).split("\\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\\(.*\\)$/, "")).filter(name => name && !/[\\/\\\\]/.test(name)).join(" < ");
const say = (label, error) => console.log("SEEN " + label + " | " + names(error));
const list = ["a", "b", "c", "d", "e"];

test("names", () => {
  for (const give of [shownAs, called, shownAs]) {
    const kept = [];
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      const probe = handedOn(function probe(path) { kept.push(new Error(path)); return 1; });
      rounds.push({ probe, ...work(list, probe, i) });
    }
    const [first] = rounds;
    say("as written", kept[0]);
    give(first.each, "for each");
    say("one that the package calls", kept[1]);
    give(first.visit, "visited");
    say("one that the application calls", kept[2]);
    give(first.inThePackage, "in a package");
    say("one of the package", kept[3]);
    give(first.probe, "probed");
    say("one of the test file", kept[4]);
    say("others", kept[5]);
  }
  expect(1).toBe(1);
});
`,
  "b.test.js": `import { expect, test } from "bun:test";
test("another file, so that the run has pieces", () => expect(1).toBe(1));
`,
});

// What a.test.js prints each time that it gives the names. It gives them three times: by displayName, by name and by displayName again.
const seenEachTime = [
  "SEEN as written | probe < visit < step < each < inThePackage < forEachOf < work < <anonymous>",
  "SEEN one that the package calls | probe < visit < step < for each < inThePackage < forEachOf < work < <anonymous>",
  "SEEN one that the application calls | probe < visited < step < for each < inThePackage < forEachOf < work < <anonymous>",
  "SEEN one of the package | probe < visited < step < for each < in a package < forEachOf < work < <anonymous>",
  "SEEN one of the test file | probed < visited < step < for each < in a package < forEachOf < work < <anonymous>",
  "SEEN others | probe < visit < step < each < inThePackage < forEachOf < work < <anonymous>",
];
// Of every run of a project: plain Bun's, and each run in layers.
const expected = {
  seen: [...seenEachTime, ...seenEachTime, ...seenEachTime],
  summary: ["2 pass", "0 fail", "2 expect() calls", "Ran 2 tests across 2 files."],
  exitCode: 0,
};

async function seenIn(directory: string, words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const command = [bunExe(), "test", "--isolate", ...(words ? ["--aot"] : [])];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  const said = stderr.split("\n").map(line => line.trim().replace(/ \[[\d.]+m?s\]$/, ""));
  return {
    seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")),
    summary: said.slice(said.findLastIndex(line => /^\d+ pass$/.test(line))).filter(Boolean),
    exitCode,
  };
}

// What the test files import is one program, or two: the package with Bun's own code, and the application above it. Each test file
// is a program of its own above them.
const layers = {
  "one layer": "TestRunLayers:1,TestRunPartFiles:1",
  "two layers": "TestRunLayers:2,TestRunPartFiles:1",
};

// A debug build of Bun lists the private helpers of built-in functions in a stack (showPrivateScriptsInStackTraces), here the one
// that flatMap calls, and compiled code lists none. One run in layers also takes five minutes or more there.
if (isDebug)
  console.error(
    "SKIPPED: test/aot/callbacks-named-by-another-program-of-a-test-run.test.ts: a debug build of Bun lists a helper of flatMap in the stacks of its plain run, and takes five minutes or more for one run in layers",
  );

// Each run in layers is a test of its own, so `bun test --max-concurrency` says how many of them are built at once.
for (const where of programs) {
  test.skipIf(isDebug).concurrent.each(Object.entries(layers))(
    `a stack taken before ${where} names the callbacks of the other programs shows the names, over %s`,
    async (_, words) => {
      using dir = tempDir("aot-callbacks-named-by-another-program", filesWithNamesGivenIn(where));
      expect(await seenIn(String(dir))).toEqual(expected);
      expect(await seenIn(String(dir), words)).toEqual(expected);
    },
    600_000,
  );
}
