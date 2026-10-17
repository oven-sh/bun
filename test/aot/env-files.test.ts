import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "./supported";

const names = ["FROM_ENV", "FROM_LOCAL", "FROM_MODE", "FROM_MODE_LOCAL", "SHARED"];
const source = `console.log(JSON.stringify(${JSON.stringify(names)}.map(name => process.env[name] ?? null)));\n`;

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NODE_ENV: undefined, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

async function build(dir: string, flags: string[] = []) {
  const built = await run([bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", "program"], dir);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return join(dir, isWindows ? "program.exe" : "program");
}

const allFiles = {
  ".env": "FROM_ENV=env\nSHARED=env\n",
  ".env.local": "FROM_LOCAL=local\nSHARED=local\n",
  ".env.development": "FROM_MODE=development\nSHARED=development\n",
  ".env.development.local": "FROM_MODE_LOCAL=development.local\nSHARED=development.local\n",
  ".env.production": "FROM_MODE=production\nSHARED=production\n",
  ".env.production.local": "FROM_MODE_LOCAL=production.local\nSHARED=production.local\n",
  ".env.test": "FROM_MODE=test\nSHARED=test\n",
  ".env.test.local": "FROM_MODE_LOCAL=test.local\nSHARED=test.local\n",
};

describe("default .env files of a compiled executable", () => {
  test("each file is found when it is the only one, and all together keep their priority", async () => {
    using dir = tempDir("aot-env-files", {
      "main.ts": source,
      "none/keep": "",
      ...Object.fromEntries(Object.entries(allFiles).map(([name, text]) => [`all/${name}`, text])),
      ...Object.fromEntries(Object.entries(allFiles).map(([name, text]) => [`only${name}/${name}`, text])),
    });
    const program = await build(String(dir));
    const output = async (folder: string, mode?: string) => {
      const result = await run([program], join(String(dir), folder), { NODE_ENV: mode });
      expect({ stderr: result.stderr, exitCode: result.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(result.stdout);
    };
    expect(await output("none")).toEqual([null, null, null, null, null]);
    expect(await output("all")).toEqual(["env", "local", "development", "development.local", "development.local"]);
    expect(await output("all", "production")).toEqual(["env", "local", "production", "production.local", "production.local"]);
    expect(await output("all", "test")).toEqual(["env", null, "test", "test.local", "test.local"]);
    expect(await output("only.env")).toEqual(["env", null, null, null, "env"]);
    expect(await output("only.env.local")).toEqual([null, "local", null, null, "local"]);
    expect(await output("only.env.local", "test")).toEqual([null, null, null, null, null]);
    expect(await output("only.env.development")).toEqual([null, null, "development", null, "development"]);
    expect(await output("only.env.development", "production")).toEqual([null, null, null, null, null]);
    expect(await output("only.env.development.local")).toEqual([null, null, null, "development.local", "development.local"]);
    expect(await output("only.env.production", "production")).toEqual([null, null, "production", null, "production"]);
    expect(await output("only.env.production")).toEqual([null, null, null, null, null]);
    expect(await output("only.env.production.local", "production")).toEqual([null, null, null, "production.local", "production.local"]);
    expect(await output("only.env.test", "test")).toEqual([null, null, "test", null, "test"]);
    expect(await output("only.env.test.local", "test")).toEqual([null, null, null, "test.local", "test.local"]);
  }, 120_000);

  test("the files of a parent directory are not read", async () => {
    using dir = tempDir("aot-env-files", { "main.ts": source, ".env": allFiles[".env"], "nested/keep": "" });
    const program = await build(String(dir));
    expect((await run([program], join(String(dir), "nested"))).stdout).toBe("[null,null,null,null,null]");
    expect((await run([program], String(dir))).stdout).toBe('["env",null,null,null,"env"]');
  }, 120_000);

  test.skipIf(isWindows)("a directory, a dangling link and an unreadable file are passed over", async () => {
    using dir = tempDir("aot-env-files", { "main.ts": source, "folder/.env.local": allFiles[".env.local"], "link/.env.local": allFiles[".env.local"], "unreadable/.env": allFiles[".env"], "unreadable/.env.local": allFiles[".env.local"] });
    const program = await build(String(dir));
    mkdirSync(join(String(dir), "folder", ".env"));
    symlinkSync("missing", join(String(dir), "link", ".env"));
    chmodSync(join(String(dir), "unreadable", ".env"), 0o000);
    for (const folder of ["folder", "link", ...(process.getuid!() === 0 ? [] : ["unreadable"])]) {
      const result = await run([program], join(String(dir), folder));
      expect({ folder, stdout: result.stdout, exitCode: result.exitCode }).toEqual({ folder, stdout: '[null,"local",null,null,"local"]', exitCode: 0 });
    }
  }, 120_000);

  test("--no-compile-autoload-dotenv reads none", async () => {
    using dir = tempDir("aot-env-files", { "main.ts": source, ...allFiles });
    const program = await build(String(dir), ["--no-compile-autoload-dotenv"]);
    expect((await run([program], String(dir))).stdout).toBe("[null,null,null,null,null]");
  }, 120_000);

  test("the files are read with tsconfig.json and package.json autoloading on", async () => {
    using dir = tempDir("aot-env-files", { "main.ts": source, "run/.env": allFiles[".env"], "run/tsconfig.json": "{}", "run/package.json": "{}", "none/keep": "" });
    const program = await build(String(dir), ["--compile-autoload-tsconfig", "--compile-autoload-package-json"]);
    expect((await run([program], join(String(dir), "run"))).stdout).toBe('["env",null,null,null,"env"]');
    expect((await run([program], join(String(dir), "none"))).stdout).toBe("[null,null,null,null,null]");
  }, 120_000);

  test("a Worker sees the same variables", async () => {
    using dir = tempDir("aot-env-files", {
      "main.ts": `const worker = new Worker(new URL("./worker.ts", import.meta.url).href);\nworker.onmessage = (event: { data: string }) => {\n  console.log(event.data);\n  worker.terminate();\n};\n`,
      "worker.ts": `postMessage(JSON.stringify(${JSON.stringify(names)}.map(name => process.env[name] ?? null)));\n`,
      "run/.env": allFiles[".env"],
      "none/keep": "",
    });
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "./worker.ts", "--outfile", "program"], String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const program = join(String(dir), isWindows ? "program.exe" : "program");
    expect((await run([program], join(String(dir), "run"))).stdout).toBe('["env",null,null,null,"env"]');
    expect((await run([program], join(String(dir), "none"))).stdout).toBe("[null,null,null,null,null]");
  }, 120_000);
});
