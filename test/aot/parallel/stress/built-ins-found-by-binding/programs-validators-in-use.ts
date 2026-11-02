// Built ins found by binding: programs validators in use. It prints what plain Bun prints.
import { Buffer } from "node:buffer";
import child_process from "node:child_process";
import dns from "node:dns";
import events, { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import { Readable } from "node:stream";
import util from "node:util";
import zlib from "node:zlib";

const emitter = new EventEmitter();
const attempts: [string, () => unknown][] = [
  ["setMaxListeners 5", () => emitter.setMaxListeners(5).getMaxListeners()],
  ["setMaxListeners -1", () => emitter.setMaxListeners(-1)],
  ["setMaxListeners text", () => emitter.setMaxListeners("x" as any)],
  ["events.setMaxListeners NaN", () => events.setMaxListeners(NaN)],
  ["readSync offset -1", () => fs.readSync(0, Buffer.alloc(1), -1 as any)],
  ["readSync offset 1.5", () => fs.readSync(0, Buffer.alloc(4), 1.5 as any)],
  ["readSync length text", () => fs.readSync(0, Buffer.alloc(4), 0, "2" as any, null)],
  ["createReadStream start -1", () => fs.createReadStream("nowhere", { start: -1 })],
  ["createReadStream start 2 end 1", () => fs.createReadStream("nowhere", { start: 2, end: 1 })],
  ["listen port 70000", () => net.createServer().listen({ port: 70000 })],
  ["listen port text", () => net.createServer().listen({ port: "x" as any })],
  ["connect port -1", () => net.connect({ port: -1 })],
  ["setTimeout text", () => new net.Socket().setTimeout("a" as any)],
  ["setTimeout 10", () => typeof new net.Socket().setTimeout(0)],
  ["deflate level 99", () => zlib.deflateSync("a", { level: 99 })],
  ["deflate level 5", () => zlib.inflateSync(zlib.deflateSync("abc", { level: 5 })).toString()],
  ["deflate chunkSize 1", () => zlib.deflateSync("a", { chunkSize: 1 })],
  ["deflate windowBits text", () => zlib.deflateSync("a", { windowBits: "9" as any })],
  ["Readable highWaterMark -1", () => new Readable({ highWaterMark: -1 })],
  ["Readable highWaterMark 8", () => new Readable({ highWaterMark: 8 }).readableHighWaterMark],
  ["spawnSync timeout -1", () => child_process.spawnSync("true", { timeout: -1 })],
  ["spawnSync maxBuffer text", () => child_process.spawnSync("true", { maxBuffer: "1" as any })],
  ["once signal 5", () => events.once(emitter, "x", { signal: 5 as any })],
  ["once signal object", () => typeof events.once(emitter, "x", { signal: { aborted: false, addEventListener() {}, removeEventListener() {} } as any })],
  ["lookup family 9", () => dns.lookup("localhost", { family: 9 as any }, () => {})],
  ["parseArgs args 5", () => util.parseArgs({ args: 5 as any })],
  ["parseArgs options 5", () => util.parseArgs({ args: [], options: 5 as any })],
  ["parseArgs", () => JSON.stringify(util.parseArgs({ args: ["-a"], options: { a: { type: "boolean", short: "a" } } }).values)],
  ["inspect options", () => util.inspect({ a: 1 }, { depth: 0 })],
  ["Buffer.alloc -1", () => Buffer.alloc(-1)],
  ["Buffer.alloc text", () => Buffer.alloc("1" as any)],
  ["readUInt8 9", () => Buffer.alloc(4).readUInt8(9)],
  ["readUIntBE 0 7", () => Buffer.alloc(8).readUIntBE(0, 7)],
  ["write hex odd", () => Buffer.alloc(4).write("abc", "hex")],
  ["mkdtemp object", () => fs.mkdtempSync({} as any)],
  ["truncate len text", () => fs.truncateSync("nowhere", "1" as any)],
  ["watchFile interval text", () => fs.watchFile("nowhere", { interval: "1" as any }, () => {})],
];
for (const [label, attempt] of attempts) {
  try {
    const answer = attempt();
    console.log(label, "->", typeof answer === "object" && answer !== null ? Object.prototype.toString.call(answer) : String(answer));
  } catch (error) {
    const { name, code, message } = error as NodeJS.ErrnoException;
    console.log(label, "throws", name, code, message);
  }
}
process.exit(0);
