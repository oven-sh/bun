import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A node:http response keeps its first write() of a short string under a Content-Length header until the tick, so that head and body go out together.
// Whoever looks for the native handle of the response by value finds one that has been given all that was written: the run time sends what is held in front of the look.
// A compiled test run has the library's own looks go by value too. write(), end() and the function that sends what is held had read the state of the response in front of
// their own look: `res.writeHead(200, { "Content-Length": "2" }).write("{}"); res.end()` threw a TypeError out of the library.
// Each shape is a project of its own, against plain `bun test`.
const shapes: Record<string, string> = {
  "a-part-and-the-end-a-tick-later": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Length", 4);
    res.write("ab");
    process.nextTick(() => res.end("cd"));
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "a-part-and-the-end-a-timer-later": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Length", 4);
    res.write("ab");
    setTimeout(() => res.end("cd"), 5);
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "a-part-and-the-response-is-destroyed": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Length", 4);
    res.write("ab");
    res.destroy();
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at).then(async it => "answer " + it.status + " " + (await it.text().catch(error => error.name)), error => "error " + error.name);
  console.log("SEEN", answer.replace(/ .*/, ""));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "a-part-and-the-rest-with-the-end": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Length", 4);
    res.write("ab");
    res.end("cd");
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "a-part-and-the-socket-is-looked-at": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Length", 4);
    res.write("ab");
    console.log("SEEN", typeof res.socket, res.headersSent, res.writableEnded);
    res.end("cd");
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "a-part-is-written-and-the-end-comes-at-once": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": "2" }).write("{}");
    res.end();
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "a-part-is-written-and-the-response-never-ends": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": "100" }).write("{}");
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const bound = new AbortController();
  const answer = await fetch(at, { signal: bound.signal });
  const body = answer.text().then(text => "text " + text, error => "error " + error.name);
  bound.abort();
  console.log("SEEN", answer.status, await body);
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "two-parts-at-once-and-the-end": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": "4" });
    res.write("ab");
    res.write("cd");
    res.end();
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
  "without-a-length": `import { test } from "bun:test";
import http from "node:http";
test("a", async () => {
  const server = http.createServer((req, res) => {
    res.write("ab");
    res.end("cd");
  });
  await new Promise<void>(done => server.listen(0, done));
  const at = "http://127.0.0.1:" + (server.address() as any).port + "/";
  const answer = await fetch(at);
  console.log("SEEN", answer.status, JSON.stringify(await answer.text()), answer.headers.get("content-length"));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
});
`,
};

for (const [name, testFile] of Object.entries(shapes)) {
  test.concurrent(`a response that holds its first write in a test run: ${name}`, async () => {
    using dir = tempDir("aot-held-write", { "package.json": `{ "name": "p", "type": "module" }\n`, "a.test.ts": testFile });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return {
        lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
        errors: stderr.split("\n").filter(line => /^\(fail\)|^[A-Za-z]*Error/.test(line)),
        exitCode,
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.lines.length).toBeGreaterThan(0);
    expect(plain.exitCode).toBe(0);
    expect(compiled).toEqual(plain);
  }, 120_000);
}
