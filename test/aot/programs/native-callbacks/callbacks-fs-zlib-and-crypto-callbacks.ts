// Callbacks handed over: each function here is the callback of one asynchronous function of node:fs, node:zlib, node:crypto, node:dns or node:stream, which passes (null or an error, a result of its own type); the program's own calls pass (number, number).
import { access, exists, readFile, readdir, realpath, stat } from "node:fs";
import { deflate, gzip } from "node:zlib";
import { pbkdf2, randomBytes, randomFill } from "node:crypto";
import { lookup } from "node:dns";
import { finished, pipeline, PassThrough, Readable } from "node:stream";

let bits = 0;

function afterStat(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 1; }
function afterMissing(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 2; }
function afterReaddir(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 4; }
function afterAccess(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 8; }
function afterExists(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 16; }
function afterRealpath(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 32; }
function afterGzip(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 64; }
function afterDeflate(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 128; }
function afterBytes(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 256; }
function afterFill(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 512; }
function afterKey(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 1024; }
function afterLookup(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 2048; }
function afterFinished(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 4096; }
function afterPipeline(a: number, b: number): void { if (typeof a !== "number" || typeof b !== "number") bits |= 8192; }

for (const own of [afterStat, afterMissing, afterReaddir, afterAccess, afterExists, afterRealpath, afterGzip, afterDeflate, afterBytes, afterFill, afterKey, afterLookup, afterFinished, afterPipeline]) own(1, 2);
stat("/", afterStat as any);
readFile("/no/such/file/anywhere", afterMissing as any);
readdir("/no/such/folder", afterReaddir as any);
access("/", afterAccess as any);
exists("/", afterExists as any);
realpath("/", afterRealpath as any);
gzip("a", afterGzip as any);
deflate("a", afterDeflate as any);
randomBytes(1, afterBytes as any);
randomFill(new Uint8Array(1), afterFill as any);
pbkdf2("p", "s", 1, 1, "sha1", afterKey as any);
lookup("127.0.0.1", afterLookup as any);
finished(Readable.from(["a"]).resume(), afterFinished as any);
pipeline(Readable.from(["a"]), new PassThrough().resume(), afterPipeline as any);
let rounds = 0;
const timer = setInterval(() => {
  if (bits !== 16383 && ++rounds < 150) return;
  clearInterval(timer);
  console.log(bits.toString(2));
}, 10);
