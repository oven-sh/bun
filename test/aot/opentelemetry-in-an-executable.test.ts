// Nothing in the program names Bun.otel: the environment of the run turns tracing on.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import "../bundler/compile-trim-features";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";

const usesTheApi = `
import { context, propagation, trace, ROOT_CONTEXT } from "@opentelemetry/api";
const tracer = trace.getTracer("library");
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.url.endsWith("/leaf")) return new Response(request.headers.get("baggage"));
    await 1;
    const baggage = propagation.createBaggage({ user: { value: "7" } });
    return context.with(propagation.setBaggage(context.active(), baggage), () =>
      tracer.startActiveSpan("of the library", async span => {
        await 1;
        const text = await (await fetch(server.url + "leaf")).text();
        span.end();
        return new Response(text);
      }),
    );
  },
});
console.log(JSON.stringify(await (await fetch(server.url)).text()), trace.getSpan(ROOT_CONTEXT));
await server.stop(true);
`;

async function build(program: string, ...flags: string[]) {
  const dir = tempDir("aot-otel", { "main.ts": program });
  const api = dirname(require.resolve("@opentelemetry/api/package.json"));
  cpSync(api, join(String(dir), "node_modules/@opentelemetry/api"), { recursive: true });
  const api110 = dirname(dirname(require.resolve("opentelemetry-api-1.10")));
  cpSync(api110, join(String(dir), "node_modules/opentelemetry-api-1.10"), { recursive: true });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const command = [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, ...flags];
  const built = await run([...command, "main.ts", "--outfile", executable], String(dir));
  expect(built).toMatchObject({ exitCode: 0 });
  return Object.assign(dir, { executable });
}

async function traced(executable: string) {
  const spans: Bun.otel.ExportedSpan[] = [];
  using collector = Bun.serve({
    port: 0,
    async fetch(request) {
      spans.push(...Bun.otel.decode(await request.bytes()));
      return new Response();
    },
  });
  const env = { ...bunEnv, BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: collector.url.href };
  const result = await run([executable], undefined, env);
  const label = (span?: Bun.otel.ExportedSpan) => span && `${span.scope.name} ${span.name}`;
  const tree = spans.map(span => `${label(span)} < ${label(spans.find(p => p.spanId === span.parentSpanId))}`);
  return { ...result, tree: tree.sort(), traces: new Set(spans.map(span => span.traceId)).size };
}

const whole = {
  stdout: `"user=7" undefined\n`,
  stderr: "",
  exitCode: 0,
  traces: 1,
  tree: [
    "bun.http.client GET < library of the library",
    "bun.http.client GET < undefined",
    "bun.http.server GET < bun.http.client GET",
    "bun.http.server GET < bun.http.client GET",
    "library of the library < bun.http.server GET",
  ],
};

describe("OpenTelemetry in an executable", () => {
  test("BUN_OTEL=1 traces Bun's APIs and serves @opentelemetry/api", async () => {
    using dir = await build(usesTheApi);
    expect(await traced(dir.executable)).toEqual(whole);
    expect(await run([dir.executable])).toEqual({ stdout: `"" undefined\n`, stderr: "", exitCode: 0 });
  });

  test("a tracer taken before Bun.otel.start() records once the provider is set through the package", async () => {
    using dir = await build(`
      import { trace, diag } from "@opentelemetry/api";
      const early = trace.getTracer("early");
      trace.setGlobalTracerProvider(Bun.otel.tracerProvider as any);
      Bun.otel.start({ exporters: [] });
      console.log(early.startSpan("x").isRecording(), diag.setLogger(console as any));
    `);
    expect(await run([dir.executable])).toEqual({ stdout: "true true\n", stderr: "", exitCode: 0 });
  });

  test.each([[[]], [["--minify"]]])(
    "the release of the package that Bun assumes registers its logger %j",
    async flags => {
      using dir = await build(
        `
      import { diag, trace } from "opentelemetry-api-1.10";
      console.log(trace.getTracer("t").startSpan("s").isRecording(), diag.setLogger(console as any));
    `,
        ...flags,
      );
      const env = { ...bunEnv, BUN_OTEL: "1", OTEL_TRACES_EXPORTER: "none" };
      expect(await run([dir.executable], undefined, env)).toEqual({ stdout: "true true\n", stderr: "", exitCode: 0 });
    },
  );

  test.skipIf(!!without("a Bun that trims"))("--trim keeps tracing for a program that names Bun.otel", async () => {
    using dir = await build("void Bun.otel;" + usesTheApi, "--trim");
    expect(await traced(dir.executable)).toEqual(whole);
  });

  test.skipIf(!!without("a Bun that trims"))(
    "--trim keeps what the exporter needs: TLS, gzip and headers",
    async () => {
      using dir = await build(
        `Bun.otel.start({ exporters: [{ url: process.argv[2], headers: { key: "k" }, compression: "gzip" }] });
       Bun.otel.span("only", () => {});`,
        "--trim",
      );
      const received: unknown[] = [];
      using collector = Bun.serve({
        port: 0,
        tls,
        async fetch(request) {
          const spans = Bun.otel.decode(Bun.gunzipSync(await request.bytes()));
          received.push(request.headers.get("key"), ...spans.map(span => span.name));
          return new Response();
        },
      });
      const env = { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
      expect(await run([dir.executable, collector.url.href], undefined, env)).toMatchObject({
        stdout: "",
        exitCode: 0,
      });
      expect(received).toEqual(["k", "only"]);
    },
  );

  test.skipIf(!!without("a Bun that trims"))("--trim removes it from any other, which says so and runs", async () => {
    using dir = await build(
      `import http from "node:http";
       import { Database } from "bun:sqlite";
       import { statSync } from "node:fs";
       const server = Bun.serve({ port: 0, routes: { "/static": new Response("a") }, fetch: () => new Response("b") });
       console.log(await (await fetch(server.url + "static")).text(), await (await fetch(server.url)).text());
       await new Promise(resolve => http.get(server.url, response => response.resume().on("end", resolve)));
       console.log(new Database(":memory:").query("select 1").values()[0][0], statSync(process.execPath).isFile());
       await server.stop(true);`,
      "--trim",
    );
    expect(await traced(dir.executable)).toEqual({
      stdout: "a b\n1 true\n",
      stderr: expect.stringContaining("this executable was built without OpenTelemetry"),
      exitCode: 0,
      traces: 0,
      tree: [],
    });
  });
});
