// `(await request.json()) as Task`: the body is parsed straight into an object of the type that the await is written under, and the
// answer is what plain Bun gives. So it is for every built-in that reads a body as JSON, whoever hands the receiver over, and
// whatever else the program holds: no other object of these programs has the names of `Task`.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(240_000);

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
  },
});

const declarations = `type Task = { title: string; points: number; labels: string[] };
function weigh(task: Task): number {
  return task.title.length + task.points + task.labels.length;
}
const text = '{"title":"ab","points":3,"labels":["x"]}';
`;

const served = (options: string, path: string) => `${declarations}
const server = Bun.serve({
  port: 0,
  ${options}
});
const answer = await fetch(\`http://127.0.0.1:\${server.port}${path}\`, { method: "POST", body: text });
console.log(await answer.text());
server.stop(true);
`;

const readInLoop = (statements: string) => `${declarations}
async function read(): Promise<number> {
  ${statements}
  return weigh(task);
}
let total = 0;
for (let turn = 0; turn < 3; turn++) total += await read();
console.log(total);
`;

const programs: Record<string, { source: string; answer: string }> = {
  "a handler of a route": {
    source: served(
      `routes: {
    "/projects/:id/tasks": {
      POST: async (request) => {
        const task = (await request.json()) as Task;
        return new Response(request.params.id + ":" + weigh(task));
      },
    },
  },
  fetch() {
    return new Response("not found", { status: 404 });
  },`,
      "/projects/7/tasks",
    ),
    answer: "7:6",
  },
  "the handler of every request": {
    source: served(
      `async fetch(request) {
    return new Response(String(weigh((await request.json()) as Task)));
  },`,
      "/",
    ),
    answer: "6",
  },
  "a request": {
    source: readInLoop(
      `const task = (await new Request("http://localhost/", { method: "POST", body: text }).json()) as Task;`,
    ),
    answer: "18",
  },
  "a response": {
    source: readInLoop(`const task = (await new Response(text).json()) as Task;`),
    answer: "18",
  },
  "the response of a fetch": {
    source: readInLoop(`const response = await fetch("data:application/json," + encodeURIComponent(text));
  const task = (await response.json()) as Task;`),
    answer: "18",
  },
  "a blob, under the type of a variable": {
    source: readInLoop(`const task: Task = await new Blob([text]).json();`),
    answer: "18",
  },
};

async function build(files: Record<string, string>, run: boolean) {
  using folder = tempDir("aot-typed-body", { ...files, "tsconfig.json": tsconfig });
  const report = join(String(folder), "report.json");
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, "./main.ts", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, exitCode } = run ? await spawned([executable], String(folder), bunEnv) : { stdout: "", exitCode: 0 };
  const selected = JSON.parse(readFileSync(report, "utf8")).statistics.TypedResultsSelected as number;
  return { stdout: stdout.trim(), exitCode, isParsedByType: selected > 0 };
}

for (const [name, { source, answer }] of Object.entries(programs)) {
  test(`${name}: the body is parsed by its type, and the answer is the same`, async () => {
    expect(await build({ "main.ts": source }, true)).toEqual({ stdout: answer, exitCode: 0, isParsedByType: true });
  });
}

// The handler hands the request to a function that other handlers call too, and then reads the body.
test("a handler that first hands its request to a shared function", async () => {
  const app = join(import.meta.dir, "servers", "app");
  const files = {
    "main.ts": readFileSync(join(app, "api-bun.ts"), "utf8"),
    "api-store.ts": readFileSync(join(app, "api-store.ts"), "utf8"),
  };
  expect((await build(files, false)).isParsedByType).toBe(true);
});

// Plain Bun parses the string itself, mark included, where the body was made of a string. Of bytes it drops the mark.
test("a body made of a string that starts with a byte order mark", async () => {
  const source = `type Task = { title: string; points: number };
async function read(source: Response): Promise<string> {
  try {
    return JSON.stringify((await source.json()) as Task);
  } catch (error) {
    return "rejected " + (error as Error).name;
  }
}
const marked = '\\ufeff{"title":"ab","points":3}';
console.log(await read(new Response(marked)), await read(new Response(new TextEncoder().encode(marked))));
`;
  expect((await build({ "main.ts": source }, true)).stdout).toBe('rejected SyntaxError {"title":"ab","points":3}');
});
