// A program that replaces process.nextTick sees the ticks that streams and node:http queue: which callbacks, how many arguments, `this`; a replacement that drops or delays ticks is obeyed; once the original is put back nothing more is seen. Modules that read process.nextTick once, when they are loaded, keep what they read.
import { createServer } from "node:http";
import { Readable, Writable } from "node:stream";

const lines: string[] = [];
const original = process.nextTick;
let seen: string[] = [];
function watch() {
  seen = [];
  process.nextTick = function (this: unknown, callback: (...all: unknown[]) => void, ...all: unknown[]) {
    seen.push((callback.name || "(anonymous)") + " " + all.length + (this === process ? "" : " with another this"));
    return original.call(this, callback, ...all);
  } as typeof process.nextTick;
}
function unwatch(what: string, inOrder: boolean) {
  process.nextTick = original;
  lines.push("-- " + what + ": " + seen.length);
  const counted = new Map<string, number>();
  for (const line of seen) counted.set(line, (counted.get(line) ?? 0) + 1);
  if (inOrder) lines.push(...seen);
  else lines.push(...[...counted].map(([line, count]) => line + " x" + count).sort());
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

watch();
await new Promise<void>(resolve => {
  const chunks: string[] = [];
  const readable = new Readable({ read() {} });
  readable.on("data", chunk => chunks.push(String(chunk)));
  readable.on("end", () => lines.push("read " + chunks.join("|")));
  readable.on("close", resolve);
  readable.push("a");
  readable.push("b");
  readable.push(null);
});
unwatch("a Readable that is read to its end", true);

watch();
await new Promise<void>(resolve => {
  const written: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk));
      done();
    },
  });
  writable.on("finish", () => lines.push("wrote " + written.join("|")));
  writable.on("close", resolve);
  writable.write("a");
  writable.write("b");
  writable.end("c");
});
unwatch("a Writable that is ended", true);

watch();
await (async () => {
  const readable = Readable.from(["x", "y"]);
  const got: string[] = [];
  for await (const chunk of readable) got.push(chunk);
  lines.push("iterated " + got.join("|"));
  await turn();
})();
unwatch("a Readable that is iterated", true);

const server = createServer((req, res) => {
  if (req.method === "GET") return void res.end("got " + req.url);
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    res.writeHead(201, { "content-type": "text/plain" });
    res.write("posted ");
    res.end(body);
  });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const url = "http://127.0.0.1:" + address.port;
lines.push(await (await fetch(url + "/warm")).text());
await turn();

watch();
lines.push(await (await fetch(url + "/one")).text());
await turn();
await turn();
unwatch("a GET without a body", false);

watch();
lines.push(await (await fetch(url + "/two", { method: "POST", body: "the body" })).text());
await turn();
await turn();
unwatch("a POST with a body", false);

lines.push(await (await fetch(url + "/three")).text());
await turn();
lines.push("seen behind the last watch: " + seen.length);

lines.push("-- a replacement that holds the ticks back");
const held: (() => void)[] = [];
process.nextTick = ((callback: (...all: unknown[]) => void, ...all: unknown[]) => void held.push(() => callback(...all))) as typeof process.nextTick;
const late = new Readable({ read() {} });
const events: string[] = [];
late.on("data", chunk => events.push("data " + chunk));
late.on("end", () => events.push("end"));
late.push("held");
late.push(null);
await turn();
lines.push("before: " + events.join() + " | held " + held.length);
process.nextTick = original;
while (held.length) held.shift()!();
await turn();
lines.push("after: " + events.join());

lines.push("-- an accessor");
let reads = 0;
Object.defineProperty(process, "nextTick", {
  configurable: true,
  get() {
    reads++;
    return original;
  },
});
await new Promise<void>(resolve => {
  const readable = new Readable({ read() {} });
  readable.on("data", () => {});
  readable.on("close", resolve);
  readable.push("a");
  readable.push(null);
});
Object.defineProperty(process, "nextTick", { configurable: true, writable: true, enumerable: true, value: original });
lines.push("read " + reads + " times");

lines.push("-- what is no function");
process.nextTick = 5 as unknown as typeof process.nextTick;
try {
  const readable = new Readable({ read() {} });
  readable.on("data", () => {});
  readable.push("a");
  lines.push("nothing thrown");
} catch (error) {
  lines.push((error as Error).constructor.name);
}
process.nextTick = original;

await new Promise<void>(resolve => server.close(() => resolve()));
console.log(lines.join("\n"));
/* Output:
read a|b
-- a Readable that is read to its end: 7
resume_ 2
maybeReadMore_ 2
emitReadable_ 1
endReadableNT 2
endReadableNT 2
endReadableNT 2
endReadableNT 2
wrote a|b|c
-- a Writable that is ended: 1
(anonymous) 2
iterated x|y
-- a Readable that is iterated: 8
nReadingNextTick 1
emitReadable_ 1
maybeReadMore_ 2
emitReadable_ 1
emitReadable_ 1
endReadableNT 2
endReadableNT 2
onDestroy 1
got /warm
got /one
-- a GET without a body: 1
emitResponseFinished 1 x1
posted the body
-- a POST with a body: 9
clearServerParserIncoming 2 x1
emitCloseNT 1 x1
emitEOFIncomingMessageOuter 1 x1
emitErrorNextTickIfErrorListener 3 x1
emitResponseFinished 1 x1
endReadableNT 2 x1
flushWriteAccountingNT 1 x1
maybeReadMore_ 2 x1
resume_ 2 x1
got /three
seen behind the last watch: 9
-- a replacement that holds the ticks back
before:  | held 3
after: data held,end
-- an accessor
read 7 times
-- what is no function
TypeError
*/
