import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import { timed } from "./lib_http.ts";

const lines: string[] = [];
const sink = new Writable({ write(chunk: Buffer, _encoding, done) { lines.push(chunk.toString().trimEnd()); done(); } });
const logger = pino({ base: null, timestamp: false, redact: ["user.password", "headers.*.secret"], serializers: { error: pino.stdSerializers.err } }, sink);
logger.info({ user: { name: "ada", password: "x" }, headers: { a: { secret: "s", open: 1 } } }, "hello %s", "world");
logger.debug("not shown");
logger.child({ request: "r1" }).warn("careful");
console.log(lines.join("\n"));
await timed("100,000 lines with redaction", () => { for (let i = 0; i < 100000; i++) logger.info({ user: { name: "n", password: "p" }, i }, "line"); });
console.log(lines.length);

const file = join(tmpdir(), "pino-smoke.log");
rmSync(file, { force: true });
try {
  const transport = pino.transport({ target: "pino/file", options: { destination: file, sync: true } });
  const threaded = pino({ base: null, timestamp: false }, transport);
  transport.on("error", (error: Error) => console.log("transport error:", error.message.split("\n")[0]));
  await Promise.race([new Promise<void>(resolve => transport.on("ready", () => resolve())), new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("not ready in 5 s")), 5000))]);
  threaded.info("through a worker");
  threaded.flush();
  await new Promise(resolve => setTimeout(resolve, 300));
  transport.end();
  await new Promise(resolve => setTimeout(resolve, 200));
  console.log("transport:", readFileSync(file, "utf8").trimEnd());
} catch (error) { console.log("transport failed:", (error as Error).message.split("\n")[0]); }
console.log("DONE");
process.exit(0);
