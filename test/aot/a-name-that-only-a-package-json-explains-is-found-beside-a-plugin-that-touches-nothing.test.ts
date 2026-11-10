// Where a program names Bun.plugin(), a load that the bundler leaves to the loader (`createRequire(import.meta.url)("#inner")`, `import.meta.require("own/x")`) is left to the loader by the compiler
// too, so that the plugin is asked first. The loader then looks among the files of the executable by walking, and a name that only a package.json explains ("#inner", the package's own name, a
// condition) isn't found that way: MODULE_NOT_FOUND, by one plugin that touches nothing. The build knows where each such name leads and writes it down, as it does for a name that it worked out.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const ask = `const ask = (said, find) => {
  try {
    console.log("SAID", said, String(find()));
  } catch (error) {
    console.log("SAID", said, "threw", error.code);
  }
};
`;
const touchesNothing = `Bun.plugin({
  name: "none",
  setup(build) {
    build.onResolve({ filter: /^never-asked$/ }, () => undefined);
  },
});
`;
const answersTheHash = `Bun.plugin({
  name: "answers",
  setup(build) {
    build.onResolve({ filter: /^#inner$/ }, () => ({ path: import.meta.dirname + "/lib/other.js" }));
  },
});
`;

const project = (plugin: string) => ({
  "package.json": JSON.stringify({
    name: "own",
    imports: {
      "#inner": "./lib/x.js",
      "#dep": "dep",
      "#by-condition": { bun: "./lib/x.js", default: "./lib/other.js" },
    },
    exports: { "./x": "./lib/x.js" },
  }),
  "lib/x.js": `exports.value = "x";\n`,
  "lib/other.js": `exports.value = "other";\n`,
  "node_modules/dep/package.json": `{ "name": "dep", "main": "./i.js" }\n`,
  "node_modules/dep/i.js": `exports.value = "dep";\n`,
  "plugin.mjs": plugin,
  "main.mjs": `import "./plugin.mjs";
import "./lib/other.js";
import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
${ask}ask("hash", () => made("#inner").value);
ask("hash of a package", () => made("#dep").value);
ask("condition", () => made("#by-condition").value);
ask("own name", () => made("own/x").value);
ask("meta hash", () => import.meta.require("#inner").value);
ask("meta own name", () => import.meta.require("own/x").value);
`,
});

const cases: Record<string, { plugin: string; hash: string }> = {
  "no plugin": { plugin: "", hash: "x" },
  "a plugin that touches nothing": { plugin: touchesNothing, hash: "x" },
  "a plugin that answers one of the names is still asked first": { plugin: answersTheHash, hash: "other" },
};

for (const [name, { plugin, hash }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("aot-a-name-that-only-a-package-json-explains", project(plugin));
    const cwd = String(dir);
    const said = [
      `SAID hash ${hash}`,
      "SAID hash of a package dep",
      "SAID condition x",
      "SAID own name x",
      `SAID meta hash ${hash}`,
      "SAID meta own name x",
      "",
    ].join("\n");
    expect(await run([bunExe(), "main.mjs"], cwd)).toEqual({ stdout: said, stderr: "", exitCode: 0 });
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "out/program"], cwd);
    expect(built.exitCode).toBe(0);
    for (const file of ["main.mjs", "plugin.mjs", "package.json", "lib", "node_modules"])
      rmSync(join(cwd, file), { recursive: true, force: true });
    expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
      stdout: said,
      stderr: "",
      exitCode: 0,
    });
  });
}
