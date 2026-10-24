// How many threads `bun build --compile --aot` starts when nobody chose a number.
//
// A thread that joins a build touches megabytes of its own first. So the compiler's pool starts a thread only when a task waits
// for one, and no more than four for what is part of every build (the libraries' declarations, Bun's own modules) plus one for
// every 32 KB of the program's own source text, as that text is read. The bundler's pool has nothing to parse and starts none.
//
// The threads of a pool live until the process ends, so the names under /proc/<pid>/task, read again and again while the
// build runs, are all the threads it started.
import { expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { test } from "../supported";

const tenLines = `const names: string[] = ["a", "b"];
function greet(name: string): string {
  return "hello " + name;
}
for (const name of names) {
  console.log(greet(name));
}
`;

function largeProgram(): Record<string, string> {
  const files: Record<string, string> = {};
  const modules = 64;
  for (let i = 0; i < modules; i++) {
    const lines: string[] = [];
    for (let j = 0; j < 200; j++)
      lines.push(
        `export function f${i}_${j}(n: number): number { const o = { a: n, b: "k${i}_${j}" }; return o.a + o.b.length + ${j}; }`,
      );
    files[`m${i}.ts`] = lines.join("\n") + "\n";
  }
  const main = Array.from({ length: modules }, (_, i) => `import * as M${i} from "./m${i}";`);
  main.push("let total = 0;");
  for (let i = 0; i < modules; i++) main.push(`total += M${i}.f${i}_0(${i});`);
  main.push("console.log(total);");
  files["main.ts"] = main.join("\n") + "\n";
  return files;
}

/** The threads that the build started, counted by their name without its number. */
async function threadsOfBuild(files: Record<string, string>, flags: string[]): Promise<Record<string, number>> {
  using folder = tempDir("aot-threads-of-a-build", { "tsconfig.json": "{}", ...files });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", join(String(folder), "main")],
    cwd: String(folder),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  let hasExited = false;
  build.exited.then(() => (hasExited = true));
  const names = new Map<string, string>();
  while (!hasExited) {
    try {
      for (const thread of readdirSync(`/proc/${build.pid}/task`))
        names.set(thread, readFileSync(`/proc/${build.pid}/task/${thread}/comm`, "utf8").trim());
    } catch {}
    await Bun.sleep(1);
  }
  const stderr = await build.stderr.text();
  expect({ exitCode: await build.exited, stderr: build.exitCode ? stderr.slice(-2000) : "" }).toEqual({
    exitCode: 0,
    stderr: "",
  });
  const counts: Record<string, number> = {};
  for (const name of names.values()) {
    const pool = name.replace(/ \d+$/, "");
    counts[pool] = (counts[pool] ?? 0) + 1;
  }
  return counts;
}

test.skipIf(!isLinux)("a ten-line program is built by a few threads", async () => {
  const threads = await threadsOfBuild({ "main.ts": tenLines }, []);
  console.log(threads);
  expect(threads["Bun Pool"] ?? 0).toBe(0);
  expect(threads["Early Load"] ?? 0).toBe(0);
  expect(threads["Bun Compile"]).toBeLessThanOrEqual(4);
});

test.skipIf(!isLinux || availableParallelism() < 16)("a program of a megabyte is built by all threads", async () => {
  const threads = await threadsOfBuild(largeProgram(), []);
  console.log(threads);
  expect(threads["Bun Pool"] ?? 0).toBe(0);
  expect(threads["Bun Compile"]).toBeGreaterThanOrEqual(12);
});

test.skipIf(!isLinux)("a chosen number of threads is kept", async () => {
  const threads = await threadsOfBuild({ "main.ts": tenLines }, ["--aot-threads=1"]);
  console.log(threads);
  expect(threads["Bun Compile"]).toBeLessThanOrEqual(3);
});
