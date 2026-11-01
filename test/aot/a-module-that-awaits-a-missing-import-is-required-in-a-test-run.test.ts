import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const modules = {
  "a-missing-file.ts": `export const v = await import("./nothing.ts");`,
  "a-computed-missing-file.ts": `const name = ["no", "thing"].join(""); export const v = await import("./" + name + ".ts");`,
  "a-missing-package.ts": `export const v = await import("a-package-that-nobody-installed");`,
  "a-missing-file-behind-a-catch.ts": `export const v = await import("./nothing.ts").catch(error => error.code);`,
  "a-file-that-is-there.ts": `export const v = (await import("./good.ts")).good;`,
  "a-rejected-promise.ts": `export const v = await Promise.reject(new RangeError("rejected at once"));`,
};
const files = {
  "package.json": `{ "type": "module" }`,
  "src/good.ts": `export const good = "good";`,
  ...Object.fromEntries(Object.entries(modules).map(([name, text]) => ["src/" + name, text])),
  "loads.test.ts": `
    import { test } from "bun:test";
    const say = (how: string, name: string, said: unknown) => console.log(how, name, String(said));
    ${Object.keys(modules)
      .map(
        name => `test("${name}", async () => {
      try { say("require", "${name}", require("./src/${name}").v); } catch (e) { say("require", "${name}", e?.constructor?.name); }
      try { say("require again", "${name}", require("./src/${name}").v); } catch (e) { say("require again", "${name}", e?.constructor?.name); }
      try { say("import", "${name}", (await import("./src/${name}")).v); } catch (e) { say("import", "${name}", e?.constructor?.name); }
    });`,
      )
      .join("\n    ")}
    test("the order of jobs", async () => {
      const order: string[] = [];
      import("./src/nothing.ts").catch(() => order.push("the import"));
      Promise.reject(new Error("rejected at once")).catch(() => order.push("a rejected promise"));
      await Promise.resolve().then(() => order.push("job 1")).then(() => order.push("job 2")).then(() => order.push("job 3")).then(() => order.push("job 4"));
      console.log(order.join(", "));
    });`,
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, env);
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each(["", "TestRunLayers:2,TestRunPartFiles:1"])(
  "the run prints what bun test prints: %s",
  async words => {
    using dir = tempDir("a-module-that-awaits-a-missing-import", files);
    const folder = String(dir);
    const plain = await runTests(folder, []);
    expect(plain).toMatchObject({ counts: [` ${Object.keys(modules).length + 1} pass`, " 0 fail"], exitCode: 0 });
    expect(plain.printed).toContain("require a-missing-file.ts TypeError");
    expect(plain.printed).toContain("import a-missing-file.ts ResolveMessage");
    expect(await runTests(folder, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);
