import type { EverydayMockCase } from "./everyday-mock-cases";

const kilnPackage = "@made-up/kiln";
const lines = (...all: (string | false)[]) => all.filter(line => line !== false && line !== "").join("\n") + "\n";

const kinds: Record<string, { path: string; isESModule: boolean }> = {
  "an-es-file": { path: "./kiln.mjs", isESModule: true },
  "a-commonjs-file": { path: "./kiln.cjs", isESModule: false },
  "an-es-package": { path: kilnPackage, isESModule: true },
  "a-commonjs-package": { path: kilnPackage, isESModule: false },
};

const bodyOfKiln = (isESModule: boolean) =>
  lines(
    "globalThis.firings = (globalThis.firings ?? 0) + 1;",
    'if (!globalThis.isLit) throw new Error("the kiln is cold");',
    isESModule ? 'export const glaze = "real";' : 'exports.glaze = "real";',
    isESModule ? 'export const clay = "kept";' : 'exports.clay = "kept";',
  );

const loads: Record<string, (kiln: string) => string> = {
  "imported-at-run-time": kiln => `const it = await import(${kiln}); return it.glaze + " " + it.clay;`,
  "required": kiln => `const it = import.meta.require(${kiln}); return it.glaze + " " + it.clay;`,
  "imported-by-a-file": () => 'return (await import("./potter.mjs")).look();',
};

const mocks: Record<string, (kiln: string) => string> = {
  "no-mock": () => "",
  "a-factory-over-the-original": kiln =>
    `vi.doMock(${kiln}, async original => ({ ...(await original()), glaze: "over" }));`,
  "a-factory-over-import-actual": kiln =>
    `vi.doMock(${kiln}, async () => ({ ...(await vi.importActual(${kiln})), glaze: "over" }));`,
  "a-factory": kiln => `vi.doMock(${kiln}, () => ({ glaze: "over", clay: "mocked" }));`,
  "mock-module": kiln => `mock.module(${kiln}, () => ({ glaze: "over", clay: "mocked" }));`,
};

const steps: Record<string, (kiln: string) => string> = {
  "nothing-between": () => "",
  "modules-reset": () => "vi.resetModules();",
  "unmocked": kiln => `vi.doUnmock(${kiln});`,
};

const places = ["in-the-same-test", "in-the-next-test", "in-the-next-test-file"];

const headOf = (load: string) =>
  lines(
    'import { test, vi, mock } from "bun:test";',
    "const tried = async (label, load) => {",
    "  let said;",
    "  try {",
    "    said = await load();",
    "  } catch (error) {",
    '    said = "threw " + String(error.message).replace(/\\/\\S*\\//g, "").slice(0, 60);',
    "  }",
    '  console.log("SAID " + label + " " + said + " firings " + (globalThis.firings ?? 0));',
    "};",
    `const load = async () => { ${load} };`,
  );

const testOf = (name: string, ...body: string[]) =>
  lines(`test(${JSON.stringify(name)}, async () => {`, ...body.filter(Boolean).map(line => "  " + line), "});");

export function failingModuleCases(): EverydayMockCase[] {
  const cases: EverydayMockCase[] = [];
  for (const [kind, { path, isESModule }] of Object.entries(kinds))
    for (const [loaded, load] of Object.entries(loads))
      for (const [mocked, mock] of Object.entries(mocks))
        for (const when of mocked === "no-mock" ? ["at-no-time"] : ["mocked-both-times", "mocked-the-second-time"])
          for (const [between, step] of Object.entries(steps))
            for (const place of places) {
              if (between === "unmocked" && when !== "mocked-both-times") continue;
              const kiln = JSON.stringify(path);
              const head = headOf(load(kiln));
              const cold = [when === "mocked-both-times" ? mock(kiln) : "", 'await tried("first", load);', step(kiln)];
              const lit = [
                "globalThis.isLit = true;",
                mock(kiln),
                'await tried("second", load);',
                'await tried("third", load);',
              ];
              const isPackage = path === kilnPackage;
              cases.push({
                name: [kind, loaded, mocked, when, between, place].join("--"),
                files: {
                  "package.json": JSON.stringify({ name: "made-up", private: true, type: "module" }) + "\n",
                  "potter.mjs": lines(
                    `import { glaze, clay } from ${kiln};`,
                    'export const look = () => glaze + " " + clay;',
                  ),
                  ...(isPackage
                    ? {
                        [`node_modules/${kilnPackage}/package.json`]:
                          JSON.stringify({
                            name: kilnPackage,
                            version: "1.0.0",
                            type: isESModule ? "module" : "commonjs",
                            main: "index.js",
                          }) + "\n",
                        [`node_modules/${kilnPackage}/index.js`]: bodyOfKiln(isESModule),
                      }
                    : { [path.slice(2)]: bodyOfKiln(isESModule) }),
                  ...(place === "in-the-same-test"
                    ? { "1-kiln.test.mjs": head + testOf("cold, then lit", ...cold, ...lit) }
                    : place === "in-the-next-test"
                      ? { "1-kiln.test.mjs": head + testOf("cold", ...cold) + testOf("lit", ...lit) }
                      : {
                          "1-cold.test.mjs": head + testOf("cold", ...cold),
                          "2-lit.test.mjs": head + testOf("lit", ...lit),
                        }),
                },
              });
            }
  return cases;
}
