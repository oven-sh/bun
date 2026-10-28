import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    noEmit: true,
    types: [],
    strict: true,
  },
});

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { stdout, said: stdout + stderr, exitCode };
}

const codes = (said: string) => [...said.matchAll(/\berror:? (TS\d+)/g)].map(match => match[1]).sort();

const classes = `class Documents {
  create(body: { input: string }): string {
    return "document " + body.input;
  }
}
class Folders {
  create(name: string): string {
    return "folder " + name;
  }
}
const documents = new Documents();
const folders = new Folders();
`;

test("a method of another class with the same name does not make a call always throw", async () => {
  using dir = tempDir("always-throws-several-callees", {
    "tsconfig.json": tsconfig,
    "main.ts": classes + `console.log(documents.create({ input: "x" }), folders.create("y"));\n`,
  });
  const checked = await run(String(dir), "check", "--aot", "main.ts");
  expect(codes(checked.said)).toEqual([]);
  expect(checked.exitCode).toBe(0);
  const built = await run(String(dir), "build", "--compile", "--aot", "main.ts", "--outfile", "program");
  expect(codes(built.said)).toEqual([]);
  expect(built.exitCode).toBe(0);
  await using proc = Bun.spawn({ cmd: [`${dir}/program`], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const ran = { stdout: await proc.stdout.text() };
  expect(ran.stdout).toBe("document x folder y\n");
}, 120_000);
