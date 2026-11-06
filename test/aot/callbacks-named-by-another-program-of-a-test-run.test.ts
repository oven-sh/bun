import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

async function seenIn(directory: string, words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...(words ? ["--aot"] : [])], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test.each(programs)(
  "a stack taken before %s names the callbacks of the other programs shows the names",
  async where => {
    using dir = tempDir("aot-callbacks-named-by-another-program", filesWithNamesGivenIn(where));
    const plain = await seenIn(String(dir));
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBe(18);
    expect(plain.seen[4]).toContain("probed < visited < step < for each < in a package < forEachOf < work");
    expect(plain.seen[5]).toContain("probe < visit < step < each < inThePackage < forEachOf < work");
    expect(await seenIn(String(dir), "TestRunLayers:1,TestRunPartFiles:1")).toEqual(plain);
    expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  240_000,
);
