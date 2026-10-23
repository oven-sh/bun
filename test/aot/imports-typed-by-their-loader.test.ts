// TypeScript finds no file for `import path from "./logo.bin" with { type: "file" }`. A build knows Bun's loaders: what the loader
// that the attribute names makes of the file says the type of the import.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const assets = {
  "first.bin": "the first asset\n",
  "sub/second.bin": "the second asset\n",
  "settings.conf": `{ "port": 8080, "hosts": ["a", "b"] }\n`,
  "note.tpl": "hello\n",
};

async function build(main: string) {
  const dir = tempDirWithBunTypes("aot-imports-typed-by-their-loader", { ...assets, "main.ts": main });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [said, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { dir, said, exitCode };
}

test.skipIf(unsupported)(
  "an import whose attribute names a loader builds and runs as under bun run",
  async () => {
    const built = await build(`
    import first from "./first.bin" with { type: "file" };
    import second from "./sub/second.bin" with { type: "file" };
    import settings from "./settings.conf" with { type: "json" };
    import note from "./note.tpl" with { type: "text" };
    const path: string = first;
    const port: number = settings.port;
    console.log(first === second, path.endsWith(".bin"), port + 1, settings.hosts.map(host => host.length).join(), note.trim());
  `);
    using dir = built.dir;
    expect({ said: built.said, exitCode: built.exitCode }).toEqual({
      said: expect.not.stringContaining("error"),
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run([join(String(dir), "out")]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "false true 8081 1,1 hello\n", stderr: "", exitCode: 0 });
  },
  120_000,
);

test.skipIf(unsupported).each([
  [
    "a path is a string",
    `import first from "./first.bin" with { type: "file" };\nconst size: number = first;\nconsole.log(size);`,
    "TS2322",
    "Type 'string' is not assignable to type 'number'",
  ],
  [
    "a text is a string",
    `import note from "./note.tpl" with { type: "text" };\nconst size: number = note;\nconsole.log(size);`,
    "TS2322",
    "Type 'string' is not assignable to type 'number'",
  ],
  [
    "data has the types of its values",
    `import settings from "./settings.conf" with { type: "json" };\nconst port: string = settings.port;\nconsole.log(port);`,
    "TS2322",
    "Type 'number' is not assignable to type 'string'",
  ],
  [
    "a file that is not there is not found",
    `import gone from "./gone.bin" with { type: "file" };\nconsole.log(gone);`,
    "error",
    "gone.bin",
  ],
])(
  "the import has the type that its loader gives it: %s",
  async (_, main, code, message) => {
    const built = await build(main);
    using dir = built.dir;
    expect(built.said).toContain(code);
    expect(built.said).toContain(message);
    expect(built.exitCode).toBe(1);
  },
  120_000,
);
