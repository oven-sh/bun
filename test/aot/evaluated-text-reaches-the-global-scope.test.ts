// `new Function(text)`, its relatives and an indirect eval work under --aot, and the build detects a call of one by what the callee is,
// under whatever name the program calls it. Their text runs in the global scope: it sees the global object, what hangs from it and what
// it is handed. It sees no binding of a module, no closure and no local class, exactly as in plain Bun.
//
// So a call that the program can reach opens that much and no more. Each program here prints what plain Bun prints, the report lists the
// call, and the build compiles about as many functions as it does for a call whose text is empty.
//
// One thing differs from plain Bun on purpose: what compiled code relies on in the built-in objects is locked, for evaluated text as for
// everybody else.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport, type BuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
});

// The build can't fold a text that depends on the arguments of the process.
const prelude = `declare var process: { argv: string[] };\nconst text = (source: string) => (process.argv.length > 99 ? "" : source);\n`;

const programs: Record<string, { text: string; output: string; evaluator: string }> = {
  "text reads and writes a global": {
    text: `(globalThis as any).counter = 1;
const bump = new Function(text("counter = counter + 41; return counter;"));
console.log(bump(), (globalThis as any).counter);
`,
    output: "42 42\n",
    evaluator: "Function",
  },
  "text calls a function that it is handed": {
    text: `const twice = (x: number) => x * 2;
const apply = new Function("f", "x", text("return f(x) + 1;"));
console.log(apply(twice, 20));
`,
    output: "41\n",
    evaluator: "Function",
  },
  "text returns a closure": {
    text: `const make = new Function("start", text("let n = start; return () => ++n;"));
const next = make(5);
console.log(next(), next());
`,
    output: "6 7\n",
    evaluator: "Function",
  },
  "text can't name a binding of a module": {
    text: `const secret = 7;
function hidden() {
  return secret;
}
let name = "";
try {
  new Function(text("return secret + hidden();"))();
} catch (error) {
  name = (error as Error).name;
}
console.log(name, hidden());
`,
    output: "ReferenceError 7\n",
    evaluator: "Function",
  },
  "text can't replace a built-in that compiled code relies on": {
    text: `const numbers = [1, 2, 3];
let outcome = "stored";
try {
  new Function(text("'use strict'; Array.prototype.map = function () { return ['replaced']; };"))();
} catch (error) {
  outcome = (error as Error).name;
}
console.log(outcome, numbers.map(x => x * 2).join());
`,
    output: "TypeError 2,4,6\n",
    evaluator: "Function",
  },
  "a template is compiled inside try and catch": {
    text: `function template(source: string) {
  const body = "with (obj) { return \`" + source.replace(/<%=(.+?)%>/g, "\${$1}") + "\`; }";
  try {
    return new Function("obj", text(body)) as (obj: object) => string;
  } catch {
    throw new Error("bad template");
  }
}
console.log(template("hello <%= name %>, <%= count + 1 %>")({ name: "world", count: 1 }));
let message = "";
try {
  template("<%= ( %>");
} catch (error) {
  message = (error as Error).message;
}
console.log(message);
`,
    output: "hello world, 2\nbad template\n",
    evaluator: "Function",
  },
  "a probe in try and catch, then a validator put together line by line": {
    text: `function allowsEval() {
  try {
    new Function("");
    return true;
  } catch {
    return false;
  }
}
class Doc {
  lines: string[] = [];
  write(line: string) {
    this.lines.push(line);
  }
  compile() {
    const F = Function;
    return new F("input", text(this.lines.join("\\n")));
  }
}
const doc = new Doc();
doc.write("const out = {};");
doc.write("out.a = input.a + 1;");
doc.write("return out;");
console.log(allowsEval(), JSON.stringify(doc.compile()({ a: 1 })));
`,
    output: `true {"a":2}\n`,
    evaluator: "Function",
  },
  "Function under another name finds the hidden constructors": {
    text: `var $Function = Function;
function getEvalledConstructor(expressionSyntax: string) {
  try {
    return $Function(text('"use strict"; return (' + expressionSyntax + ").constructor;"))();
  } catch {}
}
console.log(getEvalledConstructor("async function () {}")?.name, getEvalledConstructor("function* () {}")?.name);
`,
    output: "AsyncFunction GeneratorFunction\n",
    evaluator: "Function",
  },
  "Function found as the constructor of a function": {
    text: `const found = function () {}.constructor as FunctionConstructor;
console.log(found("a", "b", text("return a * b;"))(6, 7));
`,
    output: "42\n",
    evaluator: "Function",
  },
  "an indirect eval declares a global": {
    text: `console.log((0, eval)(text("var made = 5; made + 1")), (globalThis as any).made);
`,
    output: "6 5\n",
    evaluator: "eval",
  },
};

async function compileAndRun(text: string): Promise<{ report: BuildReport; stdout: string }> {
  using dir = tempDir("aot-evaluated-text", { "main.ts": prelude + text, "tsconfig.json": tsconfig });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const reportPath = join(folder, "report.json");
  built(
    await spawned(
      [bunExe(), ...compileCommand, ...withReport(reportPath, "summary"), "main.ts", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const ran = await spawned([executable], folder, bunEnv);
  expect({ signal: ran.signal, exitCode: ran.exitCode, stderr: ran.stderr }).toEqual({
    signal: null,
    exitCode: 0,
    stderr: "",
  });
  return { report: readBuildReport(reportPath), stdout: ran.stdout };
}

describe.concurrent("compile/aot/evaluated text reaches the global scope", () => {
  let functionsOfEmptyText = 0;

  beforeAll(async () => {
    const { report, stdout } = await slot(() => compileAndRun(`new Function(text(""))();\n`));
    expect(stdout).toBe("");
    expect(report.unseenCode).toContainEqual(expect.objectContaining({ cause: "EvaluatesText", builtin: "Function" }));
    functionsOfEmptyText = report.summary.functions;
  }, 600_000);

  for (const [name, { text, output, evaluator }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          const { report, stdout } = await compileAndRun(text);
          expect(stdout).toBe(output);
          expect(report.unseenCode).toContainEqual(
            expect.objectContaining({ cause: "EvaluatesText", builtin: evaluator }),
          );
          expect(report.summary.functions).toBeLessThanOrEqual(Math.ceil(functionsOfEmptyText * 1.25));
        }),
      600_000,
    );
  }
});
