import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const files = {
  "eval-alone.cjs": `function f() { return eval("1 + 1"); }\nconsole.log(f());\n`,
  "eval-with-a-variable.cjs": `function f() { var local = 5; return eval("local + 1"); }\nconsole.log(f());\n`,
  "callee-and-an-eval-elsewhere.cjs": `function g() { return arguments.callee; }\nconst f = () => eval("1");\nconsole.log(f(), g().name, g() === g);\n`,
  "without-an-eval.cjs": `function f() { const o = { get f() { return f; }, set f(v) { f = v; }, a: arguments }; return o; }\nconst o = f();\nconsole.log(o.f === f, o.a.callee === f, o.a.length);\nconst first = f; o.f = 7; console.log(f, first().a.callee === first);\n`,
  "the-eval-reads-and-stores-the-name.cjs": `function f(text) { return eval(text); }\nconst first = f;\nconsole.log(f("f") === f, f("arguments.callee") === f, f("typeof f"));\nf("f = 3"); console.log(f, first("arguments.callee") === first, first("f"));\n`,
  "two-declarations.cjs": `function a(text) { return eval(text); }\nfunction b(text) { return eval(text); }\nconsole.log(a("b") === b, b("a") === a, a("arguments.callee") === a, b("arguments.callee") === b, a('b("a")') === a);\n`,
  "callee-alone.cjs": `function g() { return arguments.callee; }\nconsole.log(g().name, g() === g);\n`,
  "eval-in-a-declaration-that-is-exported.cjs": `function f() { return eval("1 + 1"); }\nmodule.exports = { f }; console.log(f());\n`,
  "eval-in-a-function-expression.cjs": `const f = function () { return eval("1 + 1"); };\nconsole.log(f());\n`,
  "eval-in-a-nested-declaration.cjs": `function outer() { function inner() { return eval("1 + 1"); } return inner(); }\nconsole.log(outer());\n`,
};

async function run(cwd: string, cmd: string[]) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(Object.keys(files))(
  "%s answers under --aot as under plain Bun",
  async entry => {
    using dir = tempDir("aot-direct-eval-sloppy-scripts", files);
    const plain = await run(String(dir), [bunExe(), "run", `./${entry}`]);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(plain.stdout).not.toBe("");
    expect(await run(String(dir), [bunExe(), "run", "--aot", `./${entry}`])).toEqual(plain);
    const built = await run(String(dir), [bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", `./${entry}.exe`]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await run(String(dir), [`./${entry}.exe`])).toEqual(plain);
  },
  120_000,
);
