import { ZlibCompressionOptions } from "bun";
import { expectAssignable, expectType } from "tsd";
import Bun, { fs, fsPromises } from "./exports";

// FileBlob
expectType<ReadableStream<Uint8Array>>(Bun.file("index.test-d.ts").stream());
expectType<Promise<ArrayBuffer>>(Bun.file("index.test-d.ts").arrayBuffer());
expectType<Promise<string>>(Bun.file("index.test-d.ts").text());

expectType<number>(Bun.file("index.test-d.ts").size);
expectType<string>(Bun.file("index.test-d.ts").type);

// Hash
expectType<string>(new Bun.MD4().update("test").digest("hex"));
expectType<string>(new Bun.MD5().update("test").digest("hex"));
expectType<string>(new Bun.SHA1().update("test").digest("hex"));
expectType<string>(new Bun.SHA224().update("test").digest("hex"));
expectType<string>(new Bun.SHA256().update("test").digest("hex"));
expectType<string>(new Bun.SHA384().update("test").digest("hex"));
expectType<string>(new Bun.SHA512().update("test").digest("hex"));
expectType<string>(new Bun.SHA512_256().update("test").digest("hex"));

// Zlib Functions
expectType<Uint8Array>(Bun.deflateSync(new Uint8Array(128)));
expectType<Uint8Array>(Bun.gzipSync(new Uint8Array(128)));
expectType<Uint8Array>(
  Bun.deflateSync(new Uint8Array(128), {
    level: -1,
    memLevel: 8,
    strategy: 0,
    windowBits: 15,
  }),
);
expectType<Uint8Array>(
  Bun.gzipSync(new Uint8Array(128), { level: 9, memLevel: 6, windowBits: 27 }),
);
expectType<Uint8Array>(Bun.inflateSync(new Uint8Array(64))); // Pretend this is DEFLATE compressed data
expectType<Uint8Array>(Bun.gunzipSync(new Uint8Array(64))); // Pretend this is GZIP compressed data
expectAssignable<ZlibCompressionOptions>({ windowBits: -11 });

// Other
expectType<Promise<number>>(Bun.write("test.json", "lol"));
expectType<Promise<number>>(Bun.write("test.json", new ArrayBuffer(32)));
expectType<URL>(Bun.pathToFileURL("/foo/bar.txt"));
expectType<string>(Bun.fileURLToPath(new URL("file:///foo/bar.txt")));

// Testing ../fs.d.ts
expectType<string>(
  fs.readFileSync("./index.d.ts", { encoding: "utf-8" }).toString(),
);
expectType<boolean>(fs.existsSync("./index.d.ts"));
expectType<void>(fs.accessSync("./index.d.ts"));
expectType<void>(fs.appendFileSync("./index.d.ts", "test"));
expectType<void>(fs.mkdirSync("./index.d.ts"));

// Testing ^promises.d.ts
expectType<string>(
  (await fsPromises.readFile("./index.d.ts", { encoding: "utf-8" })).toString(),
);
expectType<Promise<void>>(fsPromises.access("./index.d.ts"));
expectType<Promise<void>>(fsPromises.appendFile("./index.d.ts", "test"));
expectType<Promise<void>>(fsPromises.mkdir("./index.d.ts"));

Bun.env;

Bun.version;

setImmediate;
clearImmediate;
setInterval;
clearInterval;
setTimeout;
clearTimeout;

const arg = new AbortSignal();
arg;

const e = new CustomEvent("asdf");
console.log(e);

exports;
module.exports;

global.AbortController;
global.Bun;

const er = new DOMException();
er.name;
er.HIERARCHY_REQUEST_ERR;

new Request(new Request("https://example.com"), {});
new Request("", { method: "POST" });

Bun.sleepSync(1); // sleep for 1 ms (not recommended)
await Bun.sleep(1); // sleep for 1 ms (recommended)

Blob;
WebSocket;
