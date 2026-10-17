import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const files = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] } }),
  "app/main.ts": `import { once } from "node:events";
const name = "./" + Buffer.alloc(100_000, "w").toString();
const said = (error: unknown) => String((error as Error).message).replace(name, "<name>").replace(/ from '.*'$/, "");
try { require(name); } catch (error) { console.log("require:", said(error)); }
try { await import(name); } catch (error) { console.log("import:", said(error)); }
try { console.log("resolve:", import.meta.resolve(name).endsWith(name.slice(1))); } catch (error) { console.log("resolve:", said(error)); }
const [event] = await once(new Worker(name), "error");
console.log("Worker:", said(event));
`,
};

async function run(cwd: string, cmd: string[]) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode, signal: ran.signalCode };
}

test.each([[["--compile-in-place"]], [[]]])("a relative name of 100,000 letters is not found, as in plain Bun: bun build --compile --aot %j", async flags => {
  using dir = tempDir("aot-names-longer-than-a-path", files);
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./main.ts"]);
  expect({ exitCode: plain.exitCode, lines: plain.stdout.split("\n").length }).toEqual({ exitCode: 0, lines: 5 });
  const built = await run(app, [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", "../built.exe"]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run(app, ["../built.exe"])).toEqual(plain);
}, 120_000);

test("nor under bun run --aot", async () => {
  using dir = tempDir("aot-names-longer-than-a-path", files);
  const app = join(String(dir), "app");
  expect(await run(app, [bunExe(), "run", "--aot", "./main.ts"])).toEqual(await run(app, [bunExe(), "run", "./main.ts"]));
}, 120_000);
