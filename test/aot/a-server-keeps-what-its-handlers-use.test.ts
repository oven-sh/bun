import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

async function keptBy(text: string) {
  using dir = tempDir("aot-handlers-of-a-server", { "main.ts": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  return {
    exitCode,
    builtInsThatEscape: lines.filter(line => line.includes("(escapes, ")).length,
    keepsFewFeatures: lines.filter(line => line.startsWith("aot: trim: kept ")).length < 40,
  };
}

const tight = { exitCode: 0, builtInsThatEscape: 0, keepsFewFeatures: true };
const behind = `\nserver.stop();`;

describe.concurrent("a handler that prints texts of its request keeps no printer of objects", () => {
  test.each([
    [
      "a method written in the options",
      `const server = Bun.serve({ port: 0, fetch(request) { console.log(request.method, request.url); return new Response("made up"); } });`,
    ],
    [
      "an async method",
      `const server = Bun.serve({ port: 0, async fetch(request) { console.log(request.method); return new Response("made up"); } });`,
    ],
    [
      "a declared function",
      `function handle(request: Request) { console.log(request.method, request.url); return new Response("made up"); }\nconst server = Bun.serve({ port: 0, fetch: handle });`,
    ],
    [
      "a field of an instance",
      `class App { name = "made up"; fetch = (request: Request) => { console.log(this.name, request.method); return new Response(this.name); }; }\nconst server = Bun.serve({ port: 0, fetch: new App().fetch });`,
    ],
    [
      "options that lie in a variable which nothing else reads",
      `const options = { port: 0, fetch(request: Request) { console.log(request.method); return new Response("made up"); } };\nconst server = Bun.serve(options);`,
    ],
    [
      "routes: a function, a function for a method, and a Response",
      `const server = Bun.serve({ port: 0, routes: { "/a": request => { console.log(request.method); return new Response("a"); }, "/b": { GET(request) { console.log(request.url); return new Response("b"); } }, "/c": new Response("c") }, fetch(request) { console.log(request.method); return new Response("made up"); } });`,
    ],
    [
      "a handler of errors beside it",
      `const server = Bun.serve({ port: 0, fetch(request) { console.log(request.method); return new Response("made up"); }, error() { console.log("failed"); return new Response("failed", { status: 500 }); } });`,
    ],
  ])("%s", async (_, text) => {
    expect(await keptBy(text + behind)).toEqual(tight);
  });

  test("options that somebody else holds keep everything, as ever", async () => {
    const found = await keptBy(
      `const options = { port: 0, fetch(request: Request) { console.log(request.method); return new Response("made up"); } };\n(globalThis as any).kept = options;\nconst server = Bun.serve(options);` +
        behind,
    );
    expect(found.exitCode).toBe(0);
    expect(found.builtInsThatEscape).toBeGreaterThan(1000);
  });
});

describe.concurrent("an error that is printed beside a server keeps no printer of objects", () => {
  test.each([
    [
      "a handler prints what it catches",
      `const server = Bun.serve({ port: 0, fetch(request) { try { return new Response(request.headers.get("accept") ?? ""); } catch (caught) { console.error(caught); return new Response("failed", { status: 500 }); } } });`,
    ],
    [
      "a handler prints what JSON.parse throws",
      `const server = Bun.serve({ port: 0, async fetch(request) { try { return Response.json(JSON.parse(await request.text())); } catch (caught) { console.error(caught); return new Response("failed", { status: 400 }); } } });`,
    ],
    [
      "a handler prints the message of what it catches",
      `const server = Bun.serve({ port: 0, fetch(request) { try { return new Response(request.headers.get("accept") ?? ""); } catch (caught) { console.error((caught as Error).message); return new Response("failed", { status: 500 }); } } });`,
    ],
    [
      "a handler prints an error that it made",
      `const server = Bun.serve({ port: 0, fetch(request) { console.error(new Error("made up")); return new Response("failed", { status: 500 }); } });`,
    ],
    [
      "the program prints what it catches beside the server",
      `const server = Bun.serve({ port: 0, fetch(request) { return new Response("made up"); } });\ntry { console.log(JSON.parse(process.argv[2] ?? "{")); } catch (caught) { console.error(caught); }`,
    ],
    [
      "routes: a function that prints the url, a function for a method that prints a parameter, and a Response",
      `const server = Bun.serve({ port: 0, routes: { "/a": request => { console.log(request.method, request.url); return new Response("a"); }, "/b/:id": { GET(request) { console.log(request.params.id); return new Response("b"); } }, "/c": new Response("c") }, fetch(request) { return new Response("made up"); } });`,
    ],
    [
      "a route prints a parameter of its request",
      `const server = Bun.serve({ port: 0, routes: { "/made/:up": { GET(request) { console.log(request.params.up); return new Response("made up"); } } }, fetch(request) { return new Response("made up"); } });`,
    ],
  ])("%s", async (_, text) => {
    expect(await keptBy(text + behind)).toEqual(tight);
  });

  test.each([
    ["the server is printed", `console.log(server);`],
    [
      "the server has left, and an error is printed",
      `(globalThis as any).kept = server;\nconsole.error(new Error("made up"));`,
    ],
    ["the error holds the server", `console.error(new Error("made up", { cause: server }));`],
  ])("%s: the printer of objects is kept", async (_, more) => {
    const found = await keptBy(
      `const server = Bun.serve({ port: 0, fetch(request) { return new Response("made up"); } });\n` + more + behind,
    );
    expect(found.exitCode).toBe(0);
    expect(found.builtInsThatEscape).toBeGreaterThan(1000);
  });
});
