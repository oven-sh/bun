// Twenty-seven node:* modules in one program, each used a little: streams, events, files, child processes, a server and a client, compression, hashes.
// It is also the text that shows what built-in calls cost the flow analysis in a program that leans on the library.
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter, once } from "node:events";
import { Readable, Writable, Transform, PassThrough, pipeline } from "node:stream";
import { pipeline as pipelineAsync } from "node:stream/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";
import { spawn, spawnSync, execFile, exec } from "node:child_process";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import * as util from "node:util";
import * as readline from "node:readline";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { Buffer } from "node:buffer";
import * as assert from "node:assert";
import * as dns from "node:dns";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";
import { StringDecoder } from "node:string_decoder";
import * as querystring from "node:querystring";
import * as tty from "node:tty";

type Options = { name: string; retries?: number; headers?: Record<string, string>; onDone?: (result: unknown) => void };

class Task extends EventEmitter {
  private chunks: Buffer[] = [];
  constructor(readonly options: Options) {
    super();
  }
  async run(command: string, args: string[]) {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TASK: this.options.name } });
    child.stdout.on("data", chunk => this.chunks.push(chunk));
    child.stderr.on("data", chunk => this.emit("warning", String(chunk)));
    const [code] = await once(child, "exit");
    this.emit("done", code, Buffer.concat(this.chunks).toString("utf8"));
    this.options.onDone?.({ code, name: this.options.name });
    return code;
  }
}

const storage = new AsyncLocalStorage<{ id: number }>();

function hashFile(file: string) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function copyCompressed(from: string, to: string) {
  await pipelineAsync(fs.createReadStream(from), zlib.createGzip(), fs.createWriteStream(to));
  return (await fsp.stat(to)).size;
}

function upper() {
  const decoder = new StringDecoder("utf8");
  return new Transform({
    transform(chunk, encoding, callback) {
      callback(null, decoder.write(chunk).toUpperCase());
    },
  });
}

function request(url: string, options: Options): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const outgoing = client.request(target, { method: "GET", headers: { ...options.headers, "user-agent": options.name } }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => (body += chunk));
      response.on("end", () => resolve(body));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "many-"));
  const file = path.join(directory, "input.txt");
  await fsp.writeFile(file, "one\ntwo\nthree\n");
  console.log(hashFile(file).length, await copyCompressed(file, file + ".gz"));

  const server = http.createServer((incoming, response) => {
    const parsed = querystring.parse(new URL(incoming.url ?? "/", "http://localhost").search.slice(1));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ parsed, method: incoming.method, headers: Object.keys(incoming.headers).length > 0 }));
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  if (address && typeof address === "object") console.log(await request(`http://127.0.0.1:${address.port}/?a=1&b=2`, { name: "many" }));
  server.close();

  const task = new Task({ name: "echo", onDone: result => console.log(util.inspect(result)) });
  task.on("done", (code, output) => console.log("done", code, output.trim()));
  await storage.run({ id: 1 }, () => task.run("echo", ["hello"]));
  console.log(spawnSync("echo", ["sync"]).stdout.toString().trim());

  const lines: string[] = [];
  const reader = readline.createInterface({ input: fs.createReadStream(file).pipe(upper()) });
  for await (const line of reader) lines.push(line);
  console.log(lines.join());

  const collected: string[] = [];
  await new Promise<void>((resolve, reject) =>
    pipeline(Readable.from(["a", "b", "c"]), new PassThrough(), new Writable({ write(chunk, encoding, callback) { collected.push(String(chunk)); callback(); } }), error => (error ? reject(error) : resolve())),
  );
  console.log(collected.join(""), performance.now() > 0, isMainThread, tty.isatty(1) === tty.isatty(1), typeof dns.lookup, typeof net.connect, typeof tls.connect, typeof Worker, typeof parentPort, typeof execFile, typeof exec);
  assert.strictEqual(fileURLToPath(pathToFileURL(file)), file);
  await sleep(1);
  fs.rmSync(directory, { recursive: true });
}

main();
