// node:readline over streams that are no terminal: line events, the async iterator, question(), a last line without a newline, CRLF, close, and node:readline/promises.
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { Readable, PassThrough, Writable } from "node:stream";

const lines = [];
const first = readline.createInterface({ input: Readable.from(["one\ntw", "o\r\nthree"]) });
first.on("line", line => lines.push(line));
await new Promise(resolve => first.on("close", resolve));
console.log(JSON.stringify(lines));

const iterated = [];
for await (const line of readline.createInterface({ input: Readable.from(["a\n\nb\n"]), crlfDelay: Infinity })) iterated.push(line);
console.log(JSON.stringify(iterated));

const written = [];
const output = new Writable({ write(chunk, encoding, done) { written.push(chunk.toString()); done(); } });
const input = new PassThrough();
const asks = readline.createInterface({ input, output, terminal: false });
const answer = new Promise(resolve => asks.question("name? ", resolve));
input.write("Ada\n");
console.log(await answer, JSON.stringify(written));
asks.close();

const input2 = new PassThrough();
const promised = createInterface({ input: input2, terminal: false });
const reply = promised.question("");
input2.write("from promises\n");
console.log(await reply);
promised.close();
console.log(typeof readline.clearLine, typeof readline.cursorTo, typeof readline.emitKeypressEvents);
