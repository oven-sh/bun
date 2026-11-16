import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

const ways = `
const ways = {
  direct: () => eval("import('./a.mjs')"),
  indirect: () => (0, eval)("import('./a.mjs')"),
  made: () => new Function("path", "return import(path)")("./a.mjs"),
  called: () => Function("path", "return import(path)")("./a.mjs"),
  bare: () => new Function("return import('./a.mjs')")(),
};
const told = async run => {
  try {
    const answer = await run();
    return answer.x === 1 ? "loaded" : String(answer);
  } catch (error) {
    return error.name;
  }
};
const ask = async what => {
  const answers = [];
  for (const run of Object.values(ways)) answers.push(await told(run));
  console.log(what, answers.join());
};
`;

async function buildAndRun(program: string) {
  using directory = tempDir("aot-replaced-evals", {
    "a.mjs": `export const x = 1;\n`,
    "main.cjs": ways + program,
  });
  const executable = join(String(directory), "main");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable],
    String(directory),
  );
  expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  const { stdout, stderr, exitCode } = await run([executable], String(directory), bunEnv);
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

test("where the build sees nothing that replaces eval or Function, the call of another one throws", async () => {
  const program = `(async () => {
  const names = JSON.parse('["eval","Function"]');
  await ask("untouched");
  globalThis[names[0]] = text => "replaced";
  await ask("eval");
  globalThis[names[1]] = function () { return () => "replaced"; };
  await ask("both");
  try {
    await ways.direct();
  } catch (error) {
    console.log(error.message);
  }
})();
`;
  expect(await buildAndRun(program)).toEqual({
    stdout: [
      "untouched loaded,loaded,loaded,loaded,loaded",
      "eval EvalError,EvalError,loaded,loaded,loaded",
      "both EvalError,EvalError,EvalError,EvalError,EvalError",
      "The compiler compiled the import() in this string, but the program has replaced eval or Function. Put the string in a variable to call the replacement.",
    ],
    stderr: "",
    exitCode: 0,
  });
});

const replacedEval = "replaced replaced,replaced,loaded,loaded,loaded";
const replacedFunction = "replaced loaded,loaded,replaced,replaced,replaced";
for (const [write, answers] of [
  [`Object.assign(globalThis, { eval: text => "replaced" })`, replacedEval],
  [`Object.assign(self, {}, { Function: function () { return () => "replaced"; } })`, replacedFunction],
  [`Reflect.set(globalThis, "eval", text => "replaced")`, replacedEval],
  [
    `Object.defineProperty(globalThis, "Function", { value: function () { return () => "replaced"; }, configurable: true })`,
    replacedFunction,
  ],
  [`Reflect.defineProperty(self, "eval", { value: text => "replaced", configurable: true })`, replacedEval],
]) {
  test(`the build sees ${write}`, async () => {
    const program = `(async () => {
  await ask("untouched");
  ${write};
  await ask("replaced");
})();
`;
    expect(await buildAndRun(program)).toEqual({
      stdout: ["untouched loaded,loaded,loaded,loaded,loaded", answers],
      stderr: "",
      exitCode: 0,
    });
  });
}

test("an import() in a written text of eval runs where eval is the realm's own, and another function is called", async () => {
  const program = `(async () => {
  const realEval = eval, realFunction = Function;
  await ask("untouched");
  globalThis.eval = text => "replaced";
  await ask("eval");
  Object.defineProperty(globalThis, "Function", { value: function () { return () => "replaced"; }, configurable: true, writable: true });
  await ask("both");
  globalThis[["ev", "al"].join("")] = realEval;
  globalThis.Function = realFunction;
  await ask("put back");
  const load = new Function("path", "return import(path)");
  let turns = 0;
  for (let i = 0; i < 80; i++) {
    if (i === 32) globalThis[JSON.parse('"eval"')] = text => "replaced";
    if ((await told(ways.direct)) === (i < 32 ? "loaded" : "replaced") && (await load("./a.mjs")).x === 1) turns++;
  }
  console.log("turns", turns);
})();
`;
  expect(await buildAndRun(program)).toEqual({
    stdout: [
      "untouched loaded,loaded,loaded,loaded,loaded",
      "eval replaced,replaced,loaded,loaded,loaded",
      "both replaced,replaced,replaced,replaced,replaced",
      "put back loaded,loaded,loaded,loaded,loaded",
      "turns 80",
    ],
    stderr: "",
    exitCode: 0,
  });
});
