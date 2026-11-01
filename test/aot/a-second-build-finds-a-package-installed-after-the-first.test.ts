// The builds of one process share the resolver's caches. The script of a page imports a package that is installed after the
// first `Bun.build` failed. The second build looks on the disk again and finds it: with plugins and without them, and with
// `compile: { aot: true }` as without `aot`.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const files = {
  "package.json": JSON.stringify({ name: "second-build", private: true }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
    files: ["main.ts"],
  }),
  "node_modules/other/index.js": "",
  "main.ts": `// @ts-ignore\nimport page from "./page.html";\nconsole.log(typeof page);\n`,
  "page.html": `<!doctype html><html><head><script type="module" src="./client.js"></script></head><body></body></html>`,
  "client.js": `import { v } from "late";\ndocument.title = "v" + v;\n`,
  "build.ts": `
    import { mkdirSync, writeFileSync } from "node:fs";
    const [kind, withPlugin] = process.argv.slice(2);
    const build = () =>
      Bun.build({
        entrypoints: ["./main.ts"],
        target: "bun",
        throw: false,
        ...(kind === "bundle" ? { outdir: "./out" } : { compile: { outfile: "./out-exe", aot: kind === "aot" } }),
        plugins: withPlugin === "plugin" ? [{ name: "none", setup() {} }] : [],
      });
    const first = await build();
    mkdirSync("./node_modules/late", { recursive: true });
    writeFileSync("./node_modules/late/package.json", JSON.stringify({ name: "late", main: "i.js" }));
    writeFileSync("./node_modules/late/i.js", "export const v = 42;\\n");
    const second = await build();
    console.log(JSON.stringify({ first: first.success, second: second.success, logs: second.logs.map(String) }));
  `,
};

describe.each(["bundle", "compile", "aot"])("Bun.build twice, %s", kind => {
  test.each(["plugin", "no plugin"])(
    "the second build finds the package that was installed after the first, %s",
    async plugin => {
      using dir = tempDir("aot-second-build", files);
      const { stdout, stderr, exitCode } = await run([bunExe(), "build.ts", kind, plugin], String(dir));
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ first: false, second: true, logs: [] }),
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
