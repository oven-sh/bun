import { afterAll, expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run as runProcess } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const entry = `const specifier = process.argv[2];
if (specifier === "engine-code") {
  const iterable = { *[Symbol.iterator]() { yield 1; yield 2; } };
  const resource = { [Symbol.dispose]() { console.log("disposed"); } };
  const texts = ["return [...value];", "class Base {} class Derived extends Base { field = 3; } return new Derived().field;", "{ using held = value; }"];
  const [spread, construct, use] = texts.map(text => new Function("value", text));
  console.log(spread(iterable).join());
  console.log(construct());
  use(resource);
} else if (specifier === "module-from-bytes") {
  // (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
  console.log(new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.add(20, 22));
} else if (specifier === "other-realm") {
  const { runInNewContext } = await import("node:vm");
  console.log(runInNewContext("[1, 2].flatMap(x => [x, x]).join()"), runInNewContext("[3, 4]").map(x => x + 1).join());
} else if (specifier) {
  await import(specifier);
} else {
  console.log(eval("1 + 1"), new Function("return 2 + 2")());
}
console.log("finished");
`;

describe("crashIfInterpreterIsUsed", () => {
  const dir = tempDir("interpreter-tripwire", { "main.mjs": entry });
  const outsideDir = tempDir("interpreter-tripwire-outside", { "outside.js": `console.log("outside");\n` });
  const program = join(String(dir), "program");
  const outsideFile = realpathSync(join(String(outsideDir), "outside.js"));
  const dataModule = `data:text/javascript,console.log("data module");`;
  const withOption = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

  beforeAll(async () => {
    const built = await runProcess(
      [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", program],
      String(dir),
      bunEnv,
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
  });

  afterAll(() => {
    dir[Symbol.dispose]();
    outsideDir[Symbol.dispose]();
  });

  test.each([
    ["with", withOption],
    ["without", bunEnv],
  ])("%s the option a file on disk outside the build is not loaded", async (_, env) => {
    const { stdout, stderr, exitCode } = await runProcess([program, outsideFile], String(outsideDir), env);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed");
    expect(stderr).toContain(`Cannot load '${outsideFile}': it isn't in this executable`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("a data: module whose text the build never saw is not loaded", async () => {
    const { stdout, stderr, exitCode } = await runProcess([program, dataModule], String(outsideDir), withOption);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed");
    expect(stderr).toContain(`Cannot load '${dataModule}': it isn't in this executable`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("eval and the Function constructor run", async () => {
    const { stdout, stderr, exitCode } = await runProcess([program], String(outsideDir), withOption);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout, exitCode }).toEqual({ stdout: "2 4\nfinished\n", exitCode: 0 });
  });

  test("the engine's own code that evaluated text reaches without naming it is compiled or counts as that text", async () => {
    const { stdout, stderr, exitCode } = await runProcess([program, "engine-code"], String(outsideDir), withOption);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout, exitCode }).toEqual({ stdout: "1,2\n3\ndisposed\nfinished\n", exitCode: 0 });
  });

  test("a WebAssembly module made from bytes, which only an import embeds, runs", async () => {
    const { stdout, stderr, exitCode } = await runProcess(
      [program, "module-from-bytes"],
      String(outsideDir),
      withOption,
    );
    expect(stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout, exitCode }).toEqual({ stdout: "42\nfinished\n", exitCode: 0 });
  });

  test("the built-in functions of another realm, which has no compiled code, run", async () => {
    const { stdout, stderr, exitCode } = await runProcess([program, "other-realm"], String(outsideDir), withOption);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout, exitCode }).toEqual({ stdout: "1,1,2,2 4,5\nfinished\n", exitCode: 0 });
  });

  test("without the option a data: module whose text the build never saw is not loaded", async () => {
    const { stdout, stderr, exitCode } = await runProcess([program, dataModule], String(outsideDir), bunEnv);
    expect(stderr).toContain(`Cannot load '${dataModule}': it isn't in this executable`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("without the option eval and the Function constructor run", async () => {
    const { stdout, exitCode } = await runProcess([program], String(outsideDir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: "2 4\nfinished\n", exitCode: 0 });
  });
});
