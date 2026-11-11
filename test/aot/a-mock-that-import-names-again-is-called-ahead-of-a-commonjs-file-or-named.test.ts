import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// import() names a file, and a mock of it waits when import() loads a file above it and above a CommonJS file: `bun test` calls the factory first. A compiled run that calls it behind the CommonJS file names the mocked file.
const files = {
  "dep.mjs": `globalThis.said?.push("run dep");\nexport const value = "real";\n`,
  "other.mjs": `globalThis.said?.push("run other");\nexport const other = "real";\n`,
  "user.mjs": `import { value } from "./dep.mjs";\nglobalThis.said?.push("run user");\nexport const seen = () => value;\n`,
  "c.cjs": `globalThis.said?.push("run c");\nexports.name = "c";\n`,
  "top.mjs": `import { seen } from "./user.mjs";\nimport c from "./c.cjs";\nglobalThis.said?.push("run top");\nexport const answer = () => seen() + c.name;\n`,
};
const bodies = {
  "mocked again": `lay("first");\n  await import("./dep.mjs");\n  vi.doUnmock("./dep.mjs");\n  lay("second");`,
  "named while another mock waits": `vi.doMock("./other.mjs", () => ({ other: "mock" }));\n  await import("./dep.mjs");\n  lay("first");`,
  "never named": `await import("./other.mjs");\n  lay("first");`,
};
const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID"));
const isCalledAhead = (text: string) => text.lastIndexOf("factory") < text.indexOf("run c,");
const sorted = (text: string) => said(text)[0]?.split(/, | /).sort();

for (const [what, body] of Object.entries(bodies)) {
  test(what, async () => {
    using dir = tempDir("aot-mock-named-again", {
      ...files,
      "a.test.mjs": `import { test, vi } from "bun:test";\nconst said = (globalThis.said ??= []);\nconst lay = name => vi.doMock("./dep.mjs", () => {\n  said.push("factory " + name);\n  return { value: name };\n});\ntest("a", async () => {\n  ${body}\n  said.push("then");\n  const top = await import("./top.mjs");\n  console.log("SAID", said.splice(0).join(", "), top.answer());\n});\n`,
    });
    const [plain, compiled] = await Promise.all([
      run([bunExe(), "test", "./a.test.mjs"], String(dir), bunEnv),
      run([bunExe(), "test", "--aot", "./a.test.mjs"], String(dir), bunEnv),
    ]);
    expect(said(plain.stdout).length).toBe(1);
    expect(compiled.exitCode).toBe(plain.exitCode);
    const isNamed = /^ {2}dep\.mjs: .*\bran$/m.test(compiled.stderr);
    expect(sorted(compiled.stdout)).toEqual(sorted(plain.stdout));
    // Where nothing named the file before, plain Bun calls the factory behind the CommonJS file. Elsewhere it does so in a few runs.
    if (what === "never named") expect([plain, compiled].map(ran => isCalledAhead(ran.stdout))).toEqual([false, false]);
    expect(isNamed).toBe(what !== "never named" && !isCalledAhead(compiled.stdout));
  });
}
