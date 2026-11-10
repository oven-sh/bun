// A file's own `export { round } from "./wide.mjs"` hides `round` in that file's `export *`, also where the statement leads back to the
// file that asked. That is the rule of the specification, and Node 25 answers the same. `bun test` falls back to the file's stars there, so
// it is no reference for these programs, and the answers are written down.
// In a ring that is made of stars alone the compiled run answers as `bun test` does.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(120_000);

const readers = {
  "last.round": `import * as all from "./last.mjs";\nexport const look = () => all.round + " " + all.only;`,
  "wide.round": `import * as barrel from "./wide.mjs";\nexport const look = () => barrel.round + " " + barrel.only;`,
  "import of last": `import { round } from "./last.mjs";\nexport const look = () => round;`,
  "import of wide": `import { round } from "./wide.mjs";\nexport const look = () => round;`,
  "names": `import * as all from "./last.mjs";\nimport * as barrel from "./wide.mjs";\nexport const look = () => Object.keys(all).join() + " | " + Object.keys(barrel).join();`,
};
type Reader = keyof typeof readers;
const everyReader = Object.keys(readers) as Reader[];

function writeProgram(files: Record<string, string>, asked: Reader[], mock: string) {
  const loads = asked.map(
    (what, index) => `  await say(${JSON.stringify(what)}, () => import("./reader${index}.mjs"));`,
  );
  return {
    "package.json": `{ "name": "made-up", "type": "module" }`,
    ...files,
    ...Object.fromEntries(asked.map((what, index) => [`reader${index}.mjs`, readers[what]])),
    "a.test.js": `import { test, vi } from "bun:test";
test("who has the name", async () => {
  ${mock}
  const say = async (what, load) => {
    try {
      console.log("SAID", what, String((await load()).look()));
    } catch (error) {
      console.log("SAID", what, error.name);
    }
  };
${loads.join("\n")}
});`,
  };
}

async function ask(files: Record<string, string>, asked: Reader[], mock = "") {
  using dir = tempDir("a-statement-hides-the-name-in-the-stars", writeProgram(files, asked, mock));
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "./a.test.js"], String(dir), bunEnv);
  const said = stdout.split("\n").filter(line => line.startsWith("SAID "));
  return { said: said.map(line => line.slice(5)), stderr: exitCode ? stderr : "", exitCode };
}
const says = (...said: string[]) => ({ said, stderr: "", exitCode: 0 });

const takesBack = `export { round } from "./wide.mjs";`;
const modules = {
  "wide.mjs": `export * from "./last.mjs";\nexport * from "./more.mjs";`,
  "last.mjs": `${takesBack}\nexport * from "./deep.mjs";`,
  "deep.mjs": `export const round = "deep", only = "only";`,
  "more.mjs": `export const round = 5;`,
};
const fromMore = says(
  "last.round 5 only",
  "wide.round 5 only",
  "import of last 5",
  "import of wide 5",
  "names only,round | only,round",
);
const nobodyHasIt = says(...everyReader.map(what => `${what} SyntaxError`));

test("the stars lead to CommonJS files", async () => {
  const files = {
    "wide.mjs": `export * from "./last.mjs";\nexport * from "./more.cjs";`,
    "last.mjs": `${takesBack}\nexport * from "./deep.cjs";`,
    "deep.cjs": `exports.round = "deep";\nexports.only = "only";`,
    "more.cjs": `exports.round = 5;`,
  };
  expect(await ask(files, everyReader)).toEqual(fromMore);
});

test("two CommonJS stars may bring the name", async () => {
  const files = {
    "wide.mjs": `export * from "./last.mjs";\nexport * from "./more.cjs";\nexport * from "./third.cjs";`,
    "last.mjs": `${takesBack}\nexport * from "./deep.cjs";`,
    "deep.cjs": `exports.round = "deep";\nexports.only = "only";`,
    "more.cjs": `exports.round = 5;`,
    "third.cjs": `exports.other = 1;`,
  };
  expect(await ask(files, everyReader)).toEqual(
    says(
      "last.round 5 only",
      "wide.round 5 only",
      "import of last 5",
      "import of wide 5",
      "names only,round | only,other,round",
    ),
  );
});

test("the stars lead to modules", async () => {
  expect(await ask(modules, everyReader)).toEqual(fromMore);
});

test("the way back is the last star", async () => {
  const files = { ...modules, "wide.mjs": `export * from "./more.mjs";\nexport * from "./last.mjs";` };
  expect(await ask(files, everyReader)).toEqual(fromMore);
});

test("the file's own star lacks the name", async () => {
  expect(await ask({ ...modules, "deep.mjs": `export const only = "only";` }, everyReader)).toEqual(fromMore);
});

test("a ring of stars alone", async () => {
  const files = { ...modules, "last.mjs": `export * from "./wide.mjs";\nexport * from "./deep.mjs";` };
  expect(await ask(files, everyReader)).toEqual(
    says(
      "last.round undefined only",
      "wide.round undefined only",
      "import of last SyntaxError",
      "import of wide SyntaxError",
      "names only | only",
    ),
  );
});

test("two statements name each other and a star has the name", async () => {
  const files = {
    ...modules,
    "wide.mjs": `export * from "./mid.mjs";`,
    "mid.mjs": `export { round } from "./last.mjs";\nexport * from "./more.mjs";`,
    "last.mjs": `export { round } from "./mid.mjs";`,
  };
  expect(await ask(files, everyReader)).toEqual(nobodyHasIt);
});

test("only the file's own star has the name", async () => {
  expect(await ask({ ...modules, "more.mjs": `export const other = 5;` }, everyReader)).toEqual(nobodyHasIt);
});

test("no ring: the file that the statement names lacks the name", async () => {
  const files = {
    ...modules,
    "last.mjs": `export { round } from "./empty.mjs";\nexport * from "./deep.mjs";`,
    "empty.mjs": `export const other = 1;`,
  };
  expect(await ask(files, ["last.round", "import of last"])).toEqual(
    says("last.round SyntaxError", "import of last SyntaxError"),
  );
});

// One reader a run: a file that lists the names of a namespace shows every export to the build.
const mock = `vi.doMock("./shapes.mjs", () => ({ round: 10 }));`;
const underMock = {
  "wide.mjs": `export * from "./last.mjs";\nexport * from "./more.cjs";\nexport * from "./shapes.mjs";`,
  "last.mjs": `${takesBack}\nexport * from "./deep.cjs";`,
  "deep.cjs": `exports.round = "deep";\nexports.only = "only";`,
  "more.cjs": `exports.round = 5;`,
  "shapes.mjs": `export const round = 1, square = 2;`,
};
const starAhead = { ...underMock, "last.mjs": `export * from "./deep.cjs";\n${takesBack}` };

for (const [what, answer] of [
  ["last.round", "5 only"],
  ["wide.round", "5 only"],
  ["import of last", "5"],
  ["import of wide", "5"],
  ["names", "only,round | only,round"],
] as [Reader, string][]) {
  test(`under a mock of a third star: ${what}`, async () => {
    expect(await ask(underMock, [what], mock)).toEqual(says(`${what} ${answer}`));
  });
}

for (const what of ["last.round", "wide.round"] as Reader[]) {
  test(`under a mock, the file's own star is written ahead of the statement: ${what}`, async () => {
    expect(await ask(starAhead, [what], mock)).toEqual(says(`${what} 5 only`));
  });
}

test("under a mock, the next star that has the name is the mocked file", async () => {
  const files = { ...underMock, "more.cjs": `exports.other = 5;` };
  expect(await ask(files, ["wide.round"], mock)).toEqual(says("wide.round 10 only"));
  expect(await ask(files, ["import of wide"], mock)).toEqual(says("import of wide 10"));
});

test("under a mock, every reader in one run", async () => {
  expect(await ask(underMock, everyReader, mock)).toEqual(fromMore);
});
