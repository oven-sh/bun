// Four Workers at once each use what the host offers: timers in their order, files, child processes, compression and hashing on the thread pool, streams, a database in memory, text codecs, URLs, async context. All answer as the main thread does.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID, scrypt } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform, pipeline } from "node:stream";
import { promisify } from "node:util";
import { deflate, gunzip, gzip, inflate } from "node:zlib";
import { Database } from "bun:sqlite";

if (process.env.IS_THE_CHILD) {
  console.log("a child");
  process.exit(0);
}
const itself = /[$~]bun/i.test(process.argv[1]!) ? [process.execPath] : [process.execPath, process.argv[1]!];

type Row = { id: number; name: string };
async function work(seed: number): Promise<string> {
  const out: string[] = [];
  const order: string[] = [];
  await new Promise<void>(resolve => {
    setTimeout(() => (order.push("timeout 2"), resolve()), 2);
    setTimeout(() => order.push("timeout 0"), 0);
    setImmediate(() => order.push("immediate"));
    process.nextTick(() => order.push("tick"));
    queueMicrotask(() => order.push("microtask"));
    Promise.resolve().then(() => order.push("promise"));
  });
  out.push(order.slice(0, 3).join());

  const folder = mkdtempSync(join(tmpdir(), "worker-"));
  await writeFile(join(folder, "a.txt"), "text " + seed);
  await Bun.write(join(folder, "b.txt"), "more " + seed);
  out.push(await readFile(join(folder, "a.txt"), "utf8"), await Bun.file(join(folder, "b.txt")).text());
  rmSync(folder, { recursive: true });

  const text = "compress me ".repeat(500) + seed;
  const zipped = await promisify(gzip)(text);
  out.push(String((await promisify(gunzip)(zipped)).toString() === text), String((await promisify(inflate)(await promisify(deflate)(text))).length));
  out.push(createHash("sha256").update(text).digest("hex").slice(0, 12), ((await promisify(scrypt)("secret", "salt" + seed, 16)) as Buffer).toString("hex").slice(0, 12), String(randomUUID().length));
  out.push(Buffer.from(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text))).toString("hex").slice(0, 12), Bun.hash.crc32(text).toString(16));

  const child = Bun.spawn(itself, { stdout: "pipe", stderr: "ignore", env: { ...process.env, IS_THE_CHILD: "1" } });
  out.push("child " + (await child.exited) + " " + ((await new Response(child.stdout).text()).length > 0));
  out.push("sync child " + Bun.spawnSync(itself, { env: { ...process.env, IS_THE_CHILD: "1" } }).exitCode);

  const database = new Database(":memory:");
  database.run("create table rows (id integer primary key, name text)");
  const insert = database.prepare("insert into rows (name) values (?)");
  for (let i = 0; i < 50; i++) insert.run("n" + (i + seed));
  const rows = database.query<Row, []>("select * from rows where id > 47 order by id").all();
  out.push(rows.map(row => row.id + row.name).join());
  database.close();

  const upper = new Transform({ transform(chunk: unknown, _: string, done: (error: null, chunk: string) => void) { done(null, String(chunk).toUpperCase()); } });
  let piped = "";
  await new Promise<void>((resolve, reject) => pipeline(Readable.from(["a", "b", "c" + seed]), upper, async function (source: AsyncIterable<string>) { for await (const chunk of source) piped += chunk; }, (error: unknown) => (error ? reject(error) : resolve())));
  out.push(piped);
  const web = new ReadableStream<string>({ start(controller) { controller.enqueue("x"); controller.enqueue("y" + seed); controller.close(); } }).pipeThrough(new TextEncoderStream()).pipeThrough(new TextDecoderStream());
  out.push((await Array.fromAsync(web)).join(""));
  out.push(await new Blob(["blob ", String(seed)]).text(), await new Response(JSON.stringify({ seed })).json().then(value => String((value as { seed: number }).seed)));

  const storage = new AsyncLocalStorage<number>();
  out.push(await storage.run(seed, async () => { await new Promise(resolve => setTimeout(resolve, 1)); return "context " + storage.getStore(); }), String(storage.getStore()));
  const emitter = new EventEmitter();
  setTimeout(() => emitter.emit("ready", seed), 1);
  out.push("emitted " + (await once(emitter, "ready"))[0]);
  const url = new URL("https://user@example.com:8080/a/b?x=" + seed + "#h");
  out.push(url.host + url.searchParams.get("x"), new Intl.NumberFormat("en-US").format(1234567.5 + seed), new Date(86400000 * seed).toISOString(), structuredClone(new Map([[seed, [seed]]])).get(seed)!.join());
  out.push(await AbortSignal.timeout(1).throwIfAborted?.() ?? "not aborted yet", String(typeof performance.now()), String(process.memoryUsage().rss > 0), String(process.hrtime.bigint() > 0n));
  return out.join(" | ");
}

if (Bun.isMainThread) {
  const workers = Array.from({ length: 4 }, () => new Worker(new URL(import.meta.url)));
  const answers = await Promise.all(workers.map((worker, seed) => new Promise<string>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => (resolve("error " + event.message.slice(0, 200)), event.preventDefault());
    worker.postMessage(seed);
  })));
  for (let seed = 0; seed < 4; seed++) {
    const mine = await work(seed);
    if (seed === 1) console.log(mine);
    console.log(seed, answers[seed] === mine ? "as here" : "ANOTHER: " + answers[seed]);
  }
  for (const worker of workers) worker.terminate();
} else {
  addEventListener("message", async (event: MessageEvent<number>) => postMessage(await work(event.data)));
}
