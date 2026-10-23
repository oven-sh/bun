// The tests run a program without standard input. Every way of reading it ends at once with nothing. Standard output is used as a stream: pipe into it, write with a callback, cork and uncork, and the order of console.log and write.
import fs from "node:fs";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import readline from "node:readline";

let pieces = 0;
for await (const piece of process.stdin) pieces += piece.length;
console.log("async iteration:", pieces, process.stdin.readableEnded);
console.log("Bun.stdin:", JSON.stringify(await Bun.stdin.text()));
console.log("descriptor 0:", fs.readFileSync(0).length);
const lines = [];
for await (const line of readline.createInterface({ input: fs.createReadStream(process.platform === "win32" ? "\\\\.\\nul" : "/dev/null") })) lines.push(line);
console.log("lines:", lines.length);

process.stdout.write("write, ");
console.log("then console.log");
await new Promise(resolve => Readable.from(["piped ", "in ", "pieces\n"]).on("end", resolve).pipe(process.stdout, { end: false }));
process.stdout.cork();
process.stdout.write("corked ");
process.stdout.write("together\n");
process.stdout.uncork();
console.log(await new Promise(resolve => process.stdout.write("", () => resolve("an empty write calls back"))), process.stdout.write("x\n"), process.stdout.writableLength >= 0, process.stdout.destroyed);
process.stderr.write("");
console.log(await text(Readable.from(["consumed"])), typeof process.stdout.on, typeof process.stdout.once, process.stdout.listenerCount("error") >= 0);
