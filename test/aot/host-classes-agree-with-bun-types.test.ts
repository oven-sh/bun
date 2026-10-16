import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const rows = readFileSync(join(import.meta.dir, "../../src/aot/build/host-classes.txt"), "utf8")
  .split("\n")
  .map(line => line.split("\t"))
  .filter(row => row[4]);

test("what a class definition says a getter yields agrees with what bun-types declares", async () => {
  expect(rows.length).toBeGreaterThan(0);
  const lines = rows.map(([holder, , name, , type]) => `export const ${holder}_${name}: Agree<${holder}[${JSON.stringify(name)}], ${type}> = true;`);
  expect(await errorsOf(lines)).toEqual([]);
});

test("a definition that disagrees is reported", async () => {
  expect(await errorsOf(['export const Request_url: Agree<Request["url"], number> = true;'])).toEqual(["agree.ts:2"]);
});

async function errorsOf(lines: string[]) {
  using dir = tempDir("host-classes", {
    "agree.ts": ["type Agree<Declared, Defined> = [Declared] extends [Defined] ? true : [Defined] extends [Declared] ? true : false;", ...lines].join("\n") + "\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "esnext",
        module: "preserve",
        moduleResolution: "bundler",
        skipLibCheck: true,
        typeRoots: [join(import.meta.dir, "../../packages")],
        types: ["bun-types"],
      },
    }),
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "check"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return [...(stdout + stderr).matchAll(/(agree\.ts)[":( ]+(?:line=")?(\d+)/g)].map(match => match[1] + ":" + match[2]);
}
