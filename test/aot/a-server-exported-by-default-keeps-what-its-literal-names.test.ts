import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

type Files = Record<string, string>;

const env = { ...bunEnv, NO_COLOR: "1" };
const first = `fetch() { return new Response("first"); }`;
const tls = `{ key: "a", cert: "b" }`;

async function keptBy(files: Files) {
  using dir = tempDir("aot-a-server-exported-by-default", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  return {
    exitCode,
    builtInsThatEscape: lines.filter(line => line.includes("(escapes, ")).length,
    keepsTls: lines.some(line => /^aot: trim: kept TLS(?: \([a-z0-9-]+\))?: used\b/.test(line)),
  };
}

async function served(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let printed = "";
  for await (const chunk of proc.stdout) {
    printed += decoder.decode(chunk, { stream: true });
    const port = /localhost:(\d+)/.exec(printed)?.[1];
    if (!port) continue;
    const answer = await fetch(`http://localhost:${port}/made`, { method: "POST", body: "up" });
    return { printed: printed.replaceAll(port, "PORT"), status: answer.status, text: await answer.text() };
  }
  return { printed, status: 0, text: "" };
}

const tight = { exitCode: 0, builtInsThatEscape: 0, keepsTls: false };

describe.concurrent("the host starts a literal that is exported by default as a written call of Bun.serve does", () => {
  test.each([
    ["a method", `export default { port: 0, fetch(request: Request) { return new Response(request.method); } };`],
    [
      "a declared function",
      `function handle(request: Request) { return new Response(request.url); }\nexport default { port: 0, fetch: handle };`,
    ],
    [
      "routes",
      `export default { port: 0, routes: { "/a": () => new Response("a"), "/b": { GET: (request: Request) => new Response(request.method) } }, ${first} };`,
    ],
    [
      "a handler of errors",
      `export default { port: 0, fetch() { throw new Error("made up"); }, error(caught: Error) { return new Response(caught.message, { status: 500 }); } };`,
    ],
    [
      "an async handler that answers JSON",
      `export default { port: 0, async fetch(request: Request) { return Response.json({ length: (await request.text()).length }); } };`,
    ],
    ["a stop that is callable, so that nothing is started", `export default { port: 0, ${first}, stop() {} };`],
    ["no handler, so that nothing is started", `export default { name: "made up" };`],
  ])("%s", async (_, text) => {
    expect(await keptBy({ "main.ts": text })).toEqual(tight);
  });

  test("an option that the literal names keeps its feature", async () => {
    expect(await keptBy({ "main.ts": `export default { port: 0, tls: ${tls}, ${first} };` })).toEqual({
      ...tight,
      keepsTls: true,
    });
  });
});

describe.concurrent("an option may be laid on the export before the host reads it", () => {
  test.each<[string, Files]>([
    [
      "by a file that imports the entry in a cycle",
      {
        "main.ts": `import { change } from "./other.ts";\nexport default { port: 0, ${first} };\nchange();`,
        "other.ts": `import entry from "./main.ts";\nexport function change() { (entry as any).tls = ${tls}; }`,
      },
    ],
    [
      "by a file that requires the entry",
      {
        "main.ts": `import { change } from "./other.ts";\nexport default { port: 0, ${first} };\nchange();`,
        "other.ts": `export function change() { require("./main.ts").default.tls = ${tls}; }`,
      },
    ],
    [
      "by a file that imports the entry with import()",
      {
        "main.ts": `import { soon } from "./other.ts";\nsoon();\nexport default { port: 0, ${first} };`,
        "other.ts": `export function soon() { import("./main.ts").then((entry: any) => { entry.default.tls = ${tls}; }); }`,
      },
    ],
    [
      "by the entry, which imports its own default",
      {
        "main.ts": `import self from "./main.ts";\nexport default { port: 0, ${first} };\n(self as any).tls = ${tls};`,
      },
    ],
    [
      "by the entry, which imports its own namespace",
      {
        "main.ts": `import * as self from "./main.ts";\nexport default { port: 0, ${first} };\n(self.default as any).tls = ${tls};`,
      },
    ],
    [
      "by the entry, which requires itself",
      {
        "main.ts": `export default { port: 0, ${first} };\nfunction change() { require("./main.ts").default.tls = ${tls}; }\nchange();`,
      },
    ],
    [
      "by a function of the entry, which names the constant that it exports as its default",
      {
        "main.ts": `const options: any = { port: 0, ${first} };\nfunction change() { options.tls = ${tls}; }\nchange();\nexport { options as default };`,
      },
    ],
    [
      "by the entry, which names the constant that it exports as its default",
      {
        "main.ts": `const options: any = { port: 0, ${first} };\noptions.tls = ${tls};\nexport { options as default };`,
      },
    ],
    [
      "by a function that the program has laid in the place of Bun.serve, as at a written call there",
      {
        "main.ts": `(Bun as any).serve = (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by an exported then, which the host hands the namespace",
      {
        "main.ts": `export default { port: 0, ${first} };\nexport function then(this: any, start: (namespace: unknown) => void) { this.default.tls = ${tls}; start(this); }`,
      },
    ],
    [
      "by a function that Object.defineProperty lays in the place of Bun.serve",
      {
        "main.ts": `Object.defineProperty(Bun, "serve", { value: (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 }) });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by a function that Object.assign lays in the place of Bun.serve",
      {
        "main.ts": `Object.assign(Bun, { serve: (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 }) });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by a direct eval in the entry",
      {
        "main.ts": `const options: any = { port: 0, ${first} };\neval("options.tls = { key: 'a', cert: 'b' }");\nexport { options as default };`,
      },
    ],
    [
      "by a direct eval in a function of the entry",
      {
        "main.ts": `const options: any = { port: 0, ${first} };\nfunction change(text: string) { eval(text); }\nchange("options.tls = { key: 'a', cert: 'b' }");\nexport { options as default };`,
      },
    ],
    [
      "by a then that a star brings",
      {
        "main.ts": `export * from "./other.ts";\nexport default { port: 0, ${first} };`,
        "other.ts": `export function then(this: any, start: (namespace: unknown) => void) { this.default.tls = ${tls}; start(this); }`,
      },
    ],
    [
      "by a function laid in the place of Bun.serve through the module bun",
      {
        "main.ts": `import bun from "bun";\n(bun as any).serve = (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by a function laid in the place of Bun.serve through require",
      {
        "main.ts": `require("bun").serve = (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by a function laid in the place of Bun.serve through the global object",
      {
        "main.ts": `(globalThis as any).Bun.serve = (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by a function that Reflect.defineProperty lays in the place of Bun.serve",
      {
        "main.ts": `Reflect.defineProperty(Bun, "serve", { value: (options: any) => ({ development: false, protocol: "http", hostname: "made", port: typeof options.fetch === "function" ? 1 : 2 }) });\nexport default { port: 0, ${first} };`,
      },
    ],
    [
      "by the entry, which keeps the literal in a list too",
      {
        "main.ts": `const held: any[] = [];\nexport default held[0] = { port: 0, ${first} };\nheld[0].tls = ${tls};`,
      },
    ],
    [
      "by a spread",
      { "main.ts": `const more = JSON.parse(process.argv[2]!);\nexport default { port: 0, ...more, ${first} };` },
    ],
  ])("%s", async (_, files) => {
    expect(await keptBy(files)).toMatchObject({ exitCode: 0, keepsTls: true });
  });
});

describe.concurrent("an executable answers as plain Bun does", () => {
  test.each<[string, Files]>([
    [
      "a method that reads its request",
      {
        "main.ts": `export default { port: 0, async fetch(request: Request) { return new Response([request.method, new URL(request.url).pathname, await request.text()].join(" ")); } };`,
      },
    ],
    [
      "this and the server",
      {
        "main.ts": `export default { port: 0, fetch(this: unknown, request: Request, server: { port: number }) { return new Response(String(this === server) + " " + typeof server.port); } };`,
      },
    ],
    [
      "a handler that another file lays in a cycle before the host reads it",
      {
        "main.ts": `import { change } from "./other.ts";\nexport default { port: 0, ${first} };\nchange();`,
        "other.ts": `import entry from "./main.ts";\nexport function change() { (entry as any).fetch = () => new Response("second"); console.log("changed"); }`,
      },
    ],
    [
      "a handler that an exported then lays through the namespace",
      {
        "main.ts": `export default { port: 0, ${first}, extra() { return "extra"; } };\nexport function then(this: any, start: (namespace: unknown) => void) { console.log(this.default.extra()); this.default.fetch = () => new Response("second"); start(this); }`,
      },
    ],
    [
      "a handler behind a getter, which is asked twice",
      {
        "main.ts": `export default { port: 0, get fetch() { console.log("asked"); return () => new Response("by a getter"); } };`,
      },
    ],
  ])("%s", async (_, files) => {
    using dir = tempDir("aot-a-server-exported-by-default-runs", files);
    const cwd = String(dir);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "served"],
      cwd,
      env,
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await build.exited).toBe(0);
    const plain = await served([bunExe(), "main.ts"], cwd);
    expect(plain.status).toBe(200);
    expect(await served(["./served"], cwd)).toEqual(plain);
  });
});
