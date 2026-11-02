import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const says = (name: string) => `(globalThis.ran ??= []).push("${name}");\n`;
const imports = (names: string[]) => names.map(name => `import "${name}";\n`).join("");

const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
};
for (const name of ["c1", "c2", "c3"]) {
  files[`node_modules/${name}/package.json`] = `{ "name": "${name}", "main": "index.js" }`;
  files[`node_modules/${name}/index.js`] = says(name) + "exports.x = 1;\n";
}
files["node_modules/c-job/package.json"] = `{ "name": "c-job", "main": "index.js" }`;
files["node_modules/c-job/index.js"] =
  says("c-job") + `Promise.resolve().then(() => globalThis.ran.push("job of c-job"));\nexports.x = 1;\n`;
for (const [name, imported] of Object.entries({
  "e-holds-c1": "c1",
  "e-holds-c2": "c2",
  "e-holds-c3": "c3",
  "e-deep": "e-holds-c3",
})) {
  files[`node_modules/${name}/package.json`] = `{ "name": "${name}", "type": "module", "main": "index.js" }`;
  files[`node_modules/${name}/index.js`] = imports([imported]) + says(name);
}
for (const name of ["l1", "l2"]) files[`src/${name}.cjs`] = says(name) + "exports.x = 1;\n";
for (const name of ["l-job", "l-job-2"])
  files[`src/${name}.cjs`] =
    says(name) + `Promise.resolve().then(() => globalThis.ran.push("job of ${name}"));\nexports.x = 1;\n`;
files["node_modules/c-requires-c3/package.json"] = `{ "name": "c-requires-c3", "main": "index.js" }`;
files["node_modules/c-requires-c3/index.js"] = says("c-requires-c3") + `require("c3");\nexports.x = 1;\n`;
files["src/m-holds-c1.mjs"] = imports(["c1"]) + says("m-holds-c1");
files["src/m-holds-c3.mjs"] = imports(["c3"]) + says("m-holds-c3");
files["src/m-holds-l1.mjs"] = imports(["./l1.cjs"]) + says("m-holds-l1");
files["src/m-holds-l2.mjs"] = imports(["./l2.cjs"]) + says("m-holds-l2");
files["src/m-deep-l1.mjs"] = imports(["./m-holds-l1.mjs"]) + says("m-deep-l1");
files["src/m-deep-c1.mjs"] = imports(["./m-holds-c1.mjs"]) + says("m-deep-c1");
files["src/m-holds-a-job-and-l1-below.mjs"] = imports(["./l-job-2.cjs", "./m-holds-l1.mjs"]) + says("m-holds-a-job");

const graphs: Record<string, { imported: string[]; ran: string; required?: string }> = {
  "a package, then a file": { imported: ["c1", "./l1.cjs"], ran: "c1,l1" },
  "a file, then a package": { imported: ["./l1.cjs", "c1"], ran: "l1,c1" },
  "packages and files in turn": { imported: ["c1", "./l1.cjs", "c2", "./l2.cjs"], ran: "c1,l1,c2,l2" },
  "files and packages in turn": { imported: ["./l1.cjs", "c1", "./l2.cjs", "c2"], ran: "l1,c1,l2,c2" },
  "a package one level down, then a package": { imported: ["./m-holds-c1.mjs", "c2"], ran: "c2,c1,m-holds-c1" },
  "a package in an ES package, then a file": { imported: ["e-holds-c1", "./l1.cjs"], ran: "l1,c1,e-holds-c1" },
  "a package in an ES package, then a file one level down": {
    imported: ["e-holds-c1", "./m-holds-l1.mjs"],
    ran: "c1,l1,e-holds-c1,m-holds-l1",
  },
  "a file one level down, then a package in an ES package": {
    imported: ["./m-holds-l1.mjs", "e-holds-c1"],
    ran: "l1,c1,m-holds-l1,e-holds-c1",
  },
  "a package two ES packages down, then a package one down": {
    imported: ["e-deep", "e-holds-c2"],
    ran: "c2,c3,e-holds-c3,e-deep,e-holds-c2",
  },
  "a package, a file one level down, a file": {
    imported: ["c1", "./m-holds-l1.mjs", "./l2.cjs"],
    ran: "c1,l2,l1,m-holds-l1",
  },
  "a package that queues a job, a file, a package in an ES package": {
    imported: ["c-job", "./l1.cjs", "e-holds-c1"],
    ran: "c-job,l1,job of c-job,c1,e-holds-c1,root",
    required: "c-job,l1,c1,e-holds-c1,root,job of c-job",
  },
  "a package that queues a job, then packages in two ES packages": {
    imported: ["c-job", "e-holds-c1", "e-holds-c2"],
    ran: "c-job,job of c-job,c1,c2,e-holds-c1,e-holds-c2,root",
    required: "c-job,c1,c2,e-holds-c1,e-holds-c2,root,job of c-job",
  },
  "a file that queues a job between packages, then a file one level down": {
    imported: ["c1", "./l-job.cjs", "c2", "./l2.cjs", "./m-holds-l1.mjs"],
    ran: "c1,l-job,c2,l2,job of l-job,l1,m-holds-l1,root",
    required: "c1,l-job,c2,l2,l1,m-holds-l1,root,job of l-job",
  },
  "a package that queues a job, a file, a package one level down": {
    imported: ["c-job", "./l1.cjs", "./m-holds-c1.mjs"],
    ran: "c-job,l1,job of c-job,c1,m-holds-c1,root",
    required: "c-job,l1,c1,m-holds-c1,root,job of c-job",
  },
  "a package that queues a job, a file, a file two levels down": {
    imported: ["c-job", "./l2.cjs", "./m-deep-l1.mjs"],
    ran: "c-job,l2,job of c-job,l1,m-holds-l1,m-deep-l1,root",
    required: "c-job,l2,l1,m-holds-l1,m-deep-l1,root,job of c-job",
  },
  "a package that queues a job, a file, a package two levels down": {
    imported: ["c-job", "./l1.cjs", "./m-deep-c1.mjs"],
    ran: "c-job,l1,job of c-job,c1,m-holds-c1,m-deep-c1,root",
    required: "c-job,l1,c1,m-holds-c1,m-deep-c1,root,job of c-job",
  },
  "jobs queued on two levels, and a file below both": {
    imported: ["c-job", "./l2.cjs", "./m-holds-a-job-and-l1-below.mjs"],
    ran: "c-job,l2,job of c-job,l-job-2,job of l-job-2,l1,m-holds-l1,m-holds-a-job,root",
    required: "c-job,l2,l-job-2,l1,m-holds-l1,m-holds-a-job,root,job of c-job,job of l-job-2",
  },
  "a package that queues a job, then files and packages one level down in turn": {
    imported: ["c-job", "./m-holds-l1.mjs", "e-holds-c1", "./m-holds-l2.mjs", "e-holds-c2"],
    ran: "c-job,job of c-job,l1,c1,l2,c2,m-holds-l1,e-holds-c1,m-holds-l2,e-holds-c2,root",
    required: "c-job,l1,c1,l2,c2,m-holds-l1,e-holds-c1,m-holds-l2,e-holds-c2,root,job of c-job",
  },
  "a package that a package above has required, one level down, and a file below it": {
    imported: ["c-requires-c3", "./m-holds-c3.mjs", "./m-deep-l1.mjs"],
    ran: "c-requires-c3,c3,l1,m-holds-c3,m-holds-l1,m-deep-l1",
  },
  "a package that queues a job, a package two ES packages down, a file one level down": {
    imported: ["c-job", "e-deep", "./m-holds-l1.mjs"],
    ran: "c-job,job of c-job,l1,c3,e-holds-c3,e-deep,m-holds-l1,root",
    required: "c-job,l1,c3,e-holds-c3,e-deep,m-holds-l1,root,job of c-job",
  },
};
const expected: string[] = [];
for (const [name, { imported, ran, required }] of Object.entries(graphs)) {
  const file = name.replaceAll(/[ ,]+/g, "-");
  files[`src/${file}.mjs`] = imports(imported) + says("root");
  files[`statement-${file}.test.js`] = `import { test } from "bun:test";
import "./src/${file}.mjs";
test("statement", () => console.log("RAN statement: ${name}: " + globalThis.ran));
`;
  files[`require-${file}.test.cjs`] = `const { test } = require("bun:test");
test("require", async () => {
  require("./src/${file}.mjs");
  await Promise.resolve();
  console.log("RAN require: ${name}: " + globalThis.ran);
});
`;
  expected.push(
    `RAN statement: ${name}: ${required ? ran : ran + ",root"}`,
    `RAN require: ${name}: ${required ?? ran + ",root"}`,
  );
}
files["the-test-file-imports-them.test.js"] = `import { test } from "bun:test";
import "c1";
import "./src/l1.cjs";
import "c2";
import "./src/l2.cjs";
test("statement", () => console.log("RAN the test file imports them: " + globalThis.ran));
`;
expected.push("RAN the test file imports them: c1,l1,c2,l2");
expected.sort();

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return {
    ran: stdout
      .split("\n")
      .filter(line => line.startsWith("RAN "))
      .sort(),
    exitCode,
  };
}

test("plain", async () => {
  using dir = tempDir("aot-commonjs-order-in-layers", files);
  expect(await runTests(String(dir), "")).toEqual({ ran: expected, exitCode: 0 });
});

for (const [form, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2"],
  ["over three layers", "TestRunLayers:3"],
]) {
  test(form, async () => {
    using dir = tempDir("aot-commonjs-order-in-layers", files);
    expect(await runTests(String(dir), words, "--aot")).toEqual({ ran: expected, exitCode: 0 });
  });
}
