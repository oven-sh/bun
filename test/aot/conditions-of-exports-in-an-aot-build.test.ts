// The conditions of "exports" that hold in an --aot build: "default", "import" or "require", "bun", "node", "node-addons", "aot", and what --conditions names.
// Not "development", which `bun build` without --aot adds unless the build is for production.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./run-programs";
import { describe, test } from "./supported";

const executable = isWindows ? "out.exe" : "out";

function fixturePackage(name: string, exports: Record<string, string>) {
  const files = Object.values(exports).map(path => {
    const says = JSON.stringify(path.replace(/^\.\/|\.\w+$/g, ""));
    return [`node_modules/${name}/${path.slice(2)}`, `export default ${says};\n`];
  });
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", type: "module", exports }),
    ...Object.fromEntries(files),
  };
}

const modes = { development: "./dev.js", production: "./prod.js" };
const files = {
  "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
  "main.ts": `import plain from "plain";
import aotFirst from "aot-first";
import aotLast from "aot-last";
console.log(plain, aotFirst, aotLast, require("plain").default, require("aot-first").default, require("aot-last").default);
`,
  ...fixturePackage("plain", { ...modes, default: "./main.js" }),
  ...fixturePackage("aot-first", { aot: "./aot.ts", ...modes, default: "./main.js" }),
  ...fixturePackage("aot-last", { ...modes, aot: "./aot.ts", default: "./main.js" }),
};

async function print(root: string, command: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await spawned(command, root, env);
  return exitCode === 0 ? stdout.trim() : `exited with ${exitCode}: ${stderr}`;
}

const twice = (answers: string) => `${answers} ${answers}`;

describe.concurrent("conditions of exports under --aot", () => {
  test.each([
    { name: "no flag", flags: [], mode: undefined, plain: "main main main", aot: "main aot aot" },
    { name: "NODE_ENV=production", flags: [], mode: "production", plain: "main main main", aot: "main aot aot" },
    { name: "NODE_ENV=development", flags: [], mode: "development", plain: "main main main", aot: "main aot aot" },
    {
      name: "--conditions=development",
      flags: ["--conditions=development"],
      mode: undefined,
      plain: "dev dev dev",
      aot: "dev aot dev",
    },
    {
      name: "--conditions=production",
      flags: ["--conditions=production"],
      mode: undefined,
      plain: "prod prod prod",
      aot: "prod aot prod",
    },
  ])("with $name", async ({ flags, mode, plain, aot }) => {
    using dir = tempDir("aot-conditions-of-exports", files);
    const root = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1", NODE_ENV: mode };
    const built = await print(
      root,
      [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", executable],
      env,
    );
    expect({
      "bun run": await print(root, [bunExe(), "run", ...flags, "./main.ts"], env),
      "bun run --conditions=aot": await print(root, [bunExe(), "run", "--conditions=aot", ...flags, "./main.ts"], env),
      "bun run --aot": await print(root, [bunExe(), "run", "--aot", ...flags, "./main.ts"], env),
      "bun build --compile --aot": built.startsWith("exited with")
        ? built
        : await print(root, [join(root, executable)], env),
    }).toEqual({
      "bun run": twice(plain),
      "bun run --conditions=aot": twice(aot),
      "bun run --aot": twice(aot),
      "bun build --compile --aot": twice(aot),
    });
  });

  test("with --production", async () => {
    using dir = tempDir("aot-conditions-of-exports", files);
    const root = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1", NODE_ENV: undefined };
    await print(
      root,
      [bunExe(), "build", "--compile", "--aot", "--production", "./main.ts", "--outfile", executable],
      env,
    );
    expect(await print(root, [join(root, executable)], env)).toBe(twice("main aot aot"));
  });
});
