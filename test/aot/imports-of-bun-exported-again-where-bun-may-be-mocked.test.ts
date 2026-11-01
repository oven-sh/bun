// `import bun, { which } from "bun"` runs as `var bun = Bun, { which } = Bun`: it loads no module, so a mock of "bun" changes none of
// the names, and a file that exports them again exports variables of its own.
import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = (name: string) =>
  casesOfOneRun("imports-of-bun-exported-again-" + name, { "package.json": `{ "name": "p", "type": "module" }` });
// The cases of a project are compiled as one program, so "bun" may be mocked in all of them as soon as one of them says so.
// A file that takes bun:test whole may mock any module.
const besideAllOfBunTest = project("beside-all-of-bun-test");
const besideAMockOfBun = project("beside-a-mock-of-bun");

const what = `const what = value =>
  value === Bun ? "Bun" : value === Bun.which ? "Bun.which" : typeof value === "string" ? value : typeof value;`;
const source = `
  import bun, { which } from "bun";
  import * as all from "bun";
  export { bun, which, all };
  export const inside = () => [bun, which, all];`;
const mock = `mock.module("bun", () => ({ default: "mocked default", which: "mocked which" }));`;
const listed = "all Bun\nbun Bun\ninside function\nwhich Bun.which\n";

function runsAsPlain(
  group: ReturnType<typeof project>,
  title: string,
  expected: string,
  body: string,
  files: Record<string, string>,
) {
  const [start, end] =
    group === besideAllOfBunTest
      ? [`(await import("bun:test")).test(`, `);`]
      : [`import { mock, test } from "bun:test";\ntest(`, `);`];
  const name = group.add(name => `${sayOf(name)}\n${what}\n${start}"${name}", async () => {${body}}${end}`, files);
  test(title, async () => {
    const plain = (await group.ran()).get(name);
    expect(plain).toEqual({ result: "pass", printed: expected });
    expect((await group.ran(["--aot"], "TestRunLayers:0")).get(name)).toEqual(plain);
    expect((await group.ran(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).get(name)).toEqual(plain);
  });
}

const listsNamespace = (path: string) => `
  const namespace = await import("${path}");
  for (const key of Object.keys(namespace)) say(key, what(namespace[key]));`;

for (const group of [besideAllOfBunTest, besideAMockOfBun]) {
  const where = group === besideAllOfBunTest ? "beside all of bun:test" : "beside a mock of bun";

  runsAsPlain(group, `the namespace object of the file is listed, ${where}`, listed, listsNamespace("./source.mjs"), {
    "source.mjs": source,
  });

  runsAsPlain(group, `the names come through export *, ${where}`, listed, listsNamespace("./front.mjs"), {
    "source.mjs": source,
    "front.mjs": `export * from "./source.mjs";`,
  });

  runsAsPlain(
    group,
    `Object.values() and Object.entries() of the namespace object, ${where}`,
    "Bun,Bun,function,Bun.which\nall:Bun,bun:Bun,inside:function,which:Bun.which\n",
    `
      const namespace = await import("./source.mjs");
      say(Object.values(namespace).map(what).join());
      say(Object.entries(namespace).map(([key, value]) => key + ":" + what(value)).join());`,
    { "source.mjs": source },
  );

  runsAsPlain(
    group,
    `require() of the file, ${where}`,
    "Bun Bun.which Bun\nBun Bun.which Bun\n",
    `
      const read = (await import("./reader.cjs")).default;
      say(...read.members.map(what));
      say(...read.taken.map(what));`,
    {
      "source.mjs": source,
      "reader.cjs": `
        const source = require("./source.mjs");
        const { bun, which, all } = source;
        module.exports = { members: [source.bun, source.which, source.all], taken: [bun, which, all] };`,
    },
  );

  runsAsPlain(
    group,
    `names, written members and what the file itself reads, ${where}`,
    "Bun Bun.which Bun\nBun Bun.which Bun\nBun Bun.which Bun\n",
    `
      const read = await import("./reader.mjs");
      say(...read.named.map(what));
      say(...read.written.map(what));
      say(...read.inside.map(what));`,
    {
      "source.mjs": source,
      "reader.mjs": `
        import * as source from "./source.mjs";
        import { bun, which, all } from "./source.mjs";
        export const named = [bun, which, all];
        export const written = [source.bun, source.which, source.all];
        export const inside = source.inside();`,
    },
  );

  runsAsPlain(
    group,
    `the default import under other names, ${where}`,
    "default Bun\nrenamed Bun\n",
    listsNamespace("./source.mjs"),
    { "source.mjs": `import bun from "bun";\nexport { bun as renamed, bun as default };` },
  );
}

runsAsPlain(besideAMockOfBun, "a mock made before the file is loaded", listed, mock + listsNamespace("./source.mjs"), {
  "source.mjs": source,
});

runsAsPlain(
  besideAMockOfBun,
  "a mock made behind the load",
  listed + listed + "Bun Bun.which Bun\n",
  `${listsNamespace("./source.mjs")}
    ${mock}
    for (const key of Object.keys(namespace)) say(key, what(namespace[key]));
    say(...namespace.inside().map(what));`,
  { "source.mjs": source },
);

runsAsPlain(
  besideAMockOfBun,
  "a mock that has neither name, and a file that exports neither",
  "Bun Bun.which\n",
  `
    mock.module("bun", () => ({ other: 1 }));
    say(...(await import("./source.mjs")).inside().map(what));`,
  { "source.mjs": `import bun, { which } from "bun";\nexport const inside = () => [bun, which];` },
);
