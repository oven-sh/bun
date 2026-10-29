// An opt-in performance test. A small server without type annotations is compiled ahead of time, warmed up, and then every
// instruction its main thread executes for a few requests is recorded (../tools/steps.c). ../tools/front-end-model.py runs a
// model of a CPU's front end over that trace. The test prints the model's table and compares three of its numbers with
// ./front-end.<os>-<arch>.json: the instructions of one request, and the misses of the first-level instruction cache in
// compiled functions and in the stubs that compiled code calls.
//
//   AOT_PERF=1 bun test test/aot/perf/front-end.test.ts        fails if a number is more than 10% above its pin
//   AOT_PERF=update bun test test/aot/perf/front-end.test.ts   rewrites the pins
//
// Without AOT_PERF, off Linux x64, or where cc or python3 is not installed, it is skipped.
import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "../harness/run";

setDefaultTimeout(120_000);

const mode = process.env.AOT_PERF;
const cc = Bun.which("cc");
const python = Bun.which("python3");
const tools = join(import.meta.dir, "..", "tools");
const pinsPath = join(import.meta.dir, `front-end.${process.platform}-${process.arch}.json`);

const sources = {
  "server.js": `
const users = new Map();
for (let i = 0; i < 64; i++) users.set("u" + i, { id: "u" + i, name: "User " + i, tags: ["a", "b", i % 2 ? "odd" : "even"], visits: 0 });
class Context {
  constructor(request, url) { this.request = request; this.url = url; this.headers = {}; this.status = 200; }
  header(name, value) { this.headers[name.toLowerCase()] = value; return this; }
  json(value) { return new Response(JSON.stringify(value), { status: this.status, headers: this.header("Content-Type", "application/json").headers }); }
  text(value) { return new Response(value, { status: this.status, headers: this.header("Content-Type", "text/plain").headers }); }
}
const routes = [];
function route(method, pattern, handler) { routes.push({ method, parts: pattern.split("/").filter(Boolean), handler }); }
function match(method, path) {
  const parts = path.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.parts.length !== parts.length) continue;
    const params = {};
    let fits = true;
    for (let i = 0; i < parts.length && fits; i++) {
      const part = candidate.parts[i];
      if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(parts[i]);
      else fits = part === parts[i];
    }
    if (fits) return { handler: candidate.handler, params };
  }
  return null;
}
const middleware = [
  (context, next) => { context.header("X-Request", String(context.url.pathname.length)); return next(); },
  (context, next) => (context.request.headers.get("accept")?.includes("nothing") ? context.text("no") : next()),
];
route("GET", "/users/:id", (context, params) => {
  const user = users.get(params.id);
  if (!user) { context.status = 404; return context.json({ error: "no such user" }); }
  user.visits++;
  return context.json({ ...user, tags: user.tags.map(tag => tag.toUpperCase()), query: Object.fromEntries(context.url.searchParams) });
});
route("GET", "/text", context => context.text("Hello"));
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    const found = match(request.method, url.pathname);
    const context = new Context(request, url);
    if (!found) { context.status = 404; return context.text("not found"); }
    let i = 0;
    const next = () => (i < middleware.length ? middleware[i++](context, next) : found.handler(context, found.params));
    return next();
  },
});
console.log(server.port);
`,
};

if (!mode) console.error("SKIPPED: test/aot/perf/front-end.test.ts: it wants a quiet machine. AOT_PERF=1 runs it");
else if (process.platform !== "linux" || process.arch !== "x64")
  console.error("SKIPPED: test/aot/perf/front-end.test.ts: its numbers are of Linux x64");
else if (!cc || !python)
  console.error(`SKIPPED: test/aot/perf/front-end.test.ts: ${cc ? "python3" : "cc"} is not installed`);

test.skipIf(!mode || !cc || !python || process.platform !== "linux" || process.arch !== "x64")(
  "compile/aot/perf/front-end",
  async () => {
    using dir = tempDir("aot-front-end", sources);
    const folder = String(dir);
    const map = join(folder, "server.map");
    const trace = join(folder, "trace");
    expect(await spawned([cc!, "-O2", "-o", join(folder, "steps"), join(tools, "steps.c")], folder)).toMatchObject({
      exitCode: 0,
    });
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", "./server.js", "--outfile", join(folder, "server")],
      folder,
      { ...bunEnv, BUN_JSC_aotMapFilePath: map },
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });

    // Without the collector every request does the same work.
    await using server = Bun.spawn({
      cmd: [join(folder, "server")],
      cwd: folder,
      env: { ...bunEnv, BUN_JSC_useAOTPerfMap: "1", BUN_JSC_useGC: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = server.stdout.getReader();
    const port = Number(new TextDecoder().decode((await reader.read()).value));
    expect(port).toBeGreaterThan(0);
    const ask = async () =>
      (await fetch(`http://127.0.0.1:${port}/users/u7?a=1&b=two`, { headers: { accept: "application/json" } })).text();
    let answer = "";
    for (let i = 0; i < 3000; i++) answer = await ask();
    expect(JSON.parse(answer)).toMatchObject({ id: "u7", tags: ["A", "B", "ODD"], query: { a: "1", b: "two" } });

    const steps = Bun.spawn({
      cmd: [join(folder, "steps"), trace, String(server.pid)],
      cwd: folder,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    while (!existsSync(trace + ".ready")) await Bun.sleep(20);
    for (let i = 0; i < 5; i++) {
      steps.kill("SIGUSR2");
      await Bun.sleep(20);
      await ask();
    }
    steps.kill("SIGTERM");
    await steps.exited;
    server.kill();

    const table = join(folder, "model.txt");
    expect(await spawned([python!, join(tools, "front-end-model.py"), trace, map, table], folder)).toMatchObject({
      exitCode: 0,
    });
    const lines = readFileSync(table, "utf8").split("\n");
    console.log(lines.slice(0, 11).join("\n"));
    const row = (name: string) =>
      lines
        .find(line => line.startsWith(name))!
        .slice(16)
        .trim()
        .split(/\s+/)
        .map(text => Number(text.replaceAll(",", "")));
    const [, missesInFunctions, , missesInStubs] = row("L1i miss");
    const now = { instructions: row("instructions")[4], missesInFunctions, missesInStubs };
    expect(now.instructions).toBeGreaterThan(1000);
    expect(row("instructions")[3]).toBeGreaterThan(100);
    if (mode === "update") return void writeFileSync(pinsPath, JSON.stringify(now, null, 2) + "\n");
    const pin: typeof now = JSON.parse(readFileSync(pinsPath, "utf8"));
    const worse = (Object.keys(now) as (keyof typeof now)[]).filter(name => now[name] > pin[name] * 1.1 + 10);
    expect({ worse, now, pin }).toEqual({ worse: [], now, pin });
  },
  600_000,
);
