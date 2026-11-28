import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// main.cjs requires m0.mjs. A CommonJS file that the graph imports requires, in its body, a module of that graph. What lies below the required module runs inside the require(), in the
// order of its imports. What only imports the file waits for its end.
// No mark of the build applies: the name is handed over on the global object, and the require() stands in a function that the body calls. Each program is held against `bun main.cjs`.
const graphs: Record<string, { imports: Record<string, string[]>; said: string }> = {
  "the bodies run depth first from the required module, not from the root": {
    imports: { m0: ["c0", "m1"], m1: ["m0"], c0: ["m0", "m1"] },
    said: "c0< c0:m0:object m0:a m1 c0:m1:object c0>",
  },
  "the root runs where it lies below the required module": {
    imports: { m0: ["c0"], m1: ["m0"], m2: ["m1"], c0: ["m2"] },
    said: "c0< m0:a m1 m2 c0:m2:object c0>",
  },
  "the root that only imports the file runs behind it": {
    imports: { m0: ["c0"], m1: [], m2: ["c1", "c0"], c0: ["m2", "m1"], c1: ["m2"] },
    said: "c0< c1< c1:m2:object c1> m2:ab:a c0:m2:object m1 c0:m1:object c0> m0:ab",
  },
  "the inner root runs behind a file of the inner load that requires a module below it": {
    imports: {
      m0: ["c0"],
      m1: ["c0", "m3"],
      m2: ["m3"],
      m3: ["m2", "m4", "c1"],
      m4: ["c1", "m2"],
      c0: ["m1"],
      c1: ["m2"],
    },
    said: "c0< c1< m4:a m3:a m2 c1:m2:object c1> m1:a c0:m1:object c0> m0:ab",
  },
  "the root waits where the required module comes back to the file and the root has more to load": {
    imports: { m0: ["c0", "m1", "m2"], m1: ["c0"], m2: ["m0", "c0"], m3: ["m1"], c0: ["m3"] },
    said: "c0< m1:a m3 c0:m3:object c0> m2:ab m0:ab",
  },
};

const isES = (name: string) => name[0] === "m";
const pathOf = (name: string) => `./${name}.${isES(name) ? "mjs" : "cjs"}`;

function filesOf(imports: Record<string, string[]>) {
  const names = Object.keys(imports);
  const files: Record<string, string> = {
    "main.cjs": `globalThis.said = [];
globalThis.names = { ${names.map(name => `${name}: "${pathOf(name)}"`).join(", ")} };
if (process.env.MADE_UP_NEVER) { ${names.map(name => `require("${pathOf(name)}");`).join(" ")} }
require("./m0.mjs");
console.log(globalThis.said.join(" "));
`,
  };
  for (const [name, list] of Object.entries(imports)) {
    if (isES(name)) {
      const heads = list.map(to => (isES(to) ? `import "${pathOf(to)}";` : `import ${to} from "${pathOf(to)}";`));
      const sees = list.filter(to => !isES(to)).map(to => ` + ":" + Object.keys(${to}).join("")`);
      files[pathOf(name)] =
        `${heads.join("\n")}\nglobalThis.said.push("${name}"${sees.join("")});\nexport const value = 1;\n`;
    } else {
      const loads = list.map(to => `globalThis.said.push("${name}:${to}:" + typeof load(globalThis.names.${to}));`);
      files[pathOf(name)] = `function load(name) { return require(name); }
globalThis.said.push("${name}<");
exports.a = 1;
${loads.join("\n")}
exports.b = 2;
globalThis.said.push("${name}>");
`;
    }
  }
  return files;
}

async function answersOf(files: Record<string, string>, entry = "main.cjs") {
  using dir = tempDir("aot-a-require-in-a-file-that-runs-during-a-load", files);
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), entry], String(dir), bunEnv);
  const built = await run([bunExe(), ...compileCommand, entry, "--outfile", executable], String(dir), bunEnv);
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(dir), bunEnv);
  return {
    plain: { stdout: plain.stdout, exitCode: plain.exitCode },
    compiled: { stdout: compiled.stdout, exitCode: compiled.exitCode },
  };
}

test.each(Object.keys(graphs))("%s", async name => {
  const { plain, compiled } = await answersOf(filesOf(graphs[name].imports));
  expect(plain).toEqual({ stdout: graphs[name].said + "\n", exitCode: 0 });
  expect(compiled).toEqual(plain);
});

// The names are written and there is no ring. The files of the inner load run in the order of its imports, whatever the outer load has read by then.
const loadsInsideLoads: Record<string, { files: Record<string, string>; said: string }> = {
  "the inner load imports a module that the outer load has read": {
    files: {
      "root.mjs": `import "./z.mjs";\nimport "./y.mjs";\nconsole.log("root");\n`,
      "z.mjs": `import "./asker.cjs";\nconsole.log("z");\n`,
      "n.mjs": `import "./cx.cjs";\nimport "./y.mjs";\nconsole.log("n");\n`,
    },
    said: "asker<\ncx\ncy\ny\nn\nasker>\nz\nroot\nmain ends\n",
  },
  "a second file stands between the one that runs and the require()": {
    files: {
      "root.mjs": `import "./z.mjs";\nimport "./y.mjs";\nconsole.log("root");\n`,
      "z.mjs": `import "./asker.cjs";\nconsole.log("z");\n`,
      "asker.cjs": `console.log("asker<");\nrequire("./mid.cjs");\nconsole.log("asker>");\n`,
      "mid.cjs": `require("./n.mjs");\n`,
      "n.mjs": `import "./cx.cjs";\nimport "./y.mjs";\nconsole.log("n");\n`,
    },
    said: "asker<\ncx\ncy\ny\nn\nasker>\nz\nroot\nmain ends\n",
  },
  "the inner load imports a module that the outer load has yet to look into": {
    files: {
      "root.mjs": `import "./asker.cjs";\nimport "./y.mjs";\nconsole.log("root");\n`,
      "n.mjs": `import "./x.mjs";\nimport "./y.mjs";\nconsole.log("n");\n`,
      "x.mjs": `import "./cx.cjs";\nconsole.log("x");\n`,
    },
    said: "asker<\ncx\nx\ncy\ny\nn\nasker>\nroot\nmain ends\n",
  },
};

test.each(Object.keys(loadsInsideLoads))("%s", async name => {
  const { plain, compiled } = await answersOf({
    "main.cjs": `require("./root.mjs");\nconsole.log("main ends");\n`,
    "y.mjs": `import "./cy.cjs";\nconsole.log("y");\n`,
    "asker.cjs": `console.log("asker<");\nrequire("./n.mjs");\nconsole.log("asker>");\n`,
    "cx.cjs": `console.log("cx");\n`,
    "cy.cjs": `console.log("cy");\n`,
    ...loadsInsideLoads[name].files,
  });
  expect(plain).toEqual({ stdout: loadsInsideLoads[name].said, exitCode: 0 });
  expect(compiled).toEqual(plain);
});

test("a tick that an imported file queues runs behind the body of its importer", async () => {
  const files = {
    "upper.mjs": `import asks from "./asks.cjs";\nconsole.log("upper over " + asks.name);\n`,
    "asks.cjs": `process.nextTick(() => {\n  console.log("tick of asks");\n  import("./late.mjs");\n});\nconsole.log("asks");\nexports.name = "asks";\n`,
    "late.mjs": `console.log("late");\n`,
  };
  const { plain, compiled } = await answersOf(files, "upper.mjs");
  expect(plain).toEqual({ stdout: "asks\nupper over asks\ntick of asks\nlate\n", exitCode: 0 });
  expect(compiled).toEqual(plain);
});

test("a second file between the one that runs ahead and the require() of the root", async () => {
  const { plain, compiled } = await answersOf({
    "main.cjs": `globalThis.names = { mid: "./mid.cjs" };\nif (process.env.MADE_UP_NEVER) require("./mid.cjs");\nrequire("./root.mjs");\nconsole.log("main ends");\n`,
    "root.mjs": `import "./asker.cjs";\nimport "./beside.mjs";\nconsole.log("root");\n`,
    "beside.mjs": `import "./root.mjs";\nconsole.log("beside");\n`,
    "asker.cjs": `console.log("asker<");\nrequire(globalThis.names.mid);\nconsole.log("asker>");\n`,
    "mid.cjs": `require("./root.mjs");\nconsole.log("between");\nrequire("./beside.mjs");\nconsole.log("mid ends");\n`,
  });
  expect(plain).toEqual({ stdout: "asker<\nbetween\nroot\nbeside\nmid ends\nasker>\nmain ends\n", exitCode: 0 });
  expect(compiled).toEqual(plain);
});
