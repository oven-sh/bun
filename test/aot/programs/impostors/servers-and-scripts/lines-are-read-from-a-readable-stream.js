import readline from "node:readline";
import { PassThrough, Readable, Writable } from "node:stream";
import { text } from "node:stream/consumers";

const source = Readable.from(["alpha\nbe", "ta\r\ngam", "ma\n\ndelta"]);
const lines = [];
for await (const line of readline.createInterface({ input: source, crlfDelay: Infinity })) lines.push(line);
console.log(lines);

const seen = [];
const sink = new Writable({
  objectMode: true,
  write(record, encoding, done) {
    seen.push(record.id * 2);
    done();
  },
  final(done) {
    seen.push("final");
    done();
  },
});
await new Promise((resolve, reject) => Readable.from([{ id: 1 }, { id: 2 }, { id: 3 }]).pipe(sink).on("finish", resolve).on("error", reject));
console.log(seen);

const through = new PassThrough();
through.write("one ");
through.write(Buffer.from("two "));
through.end("three");
console.log(await text(through));

const counted = new Readable({
  read() {
    this.count = (this.count ?? 0) + 1;
    this.push(this.count > 3 ? null : "chunk" + this.count);
  },
});
counted.setEncoding("utf8");
const events = [];
counted.on("data", piece => events.push(piece));
counted.on("end", () => events.push("end"));
counted.on("close", () => console.log(events, counted.destroyed, counted.readableEnded));
