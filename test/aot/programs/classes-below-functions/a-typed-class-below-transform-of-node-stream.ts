// Typed code: the class, its fields and the options are declared, and the methods of the library are called on its objects.
import { Transform, type TransformCallback, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
class Upper extends Transform {
  chunks: number = 0;
  readonly label: string;
  constructor(label: string) { super({ decodeStrings: false, encoding: "utf8" }); this.label = label; }
  override _transform(chunk: string, encoding: BufferEncoding, done: TransformCallback): void {
    this.chunks++;
    done(null, chunk.toUpperCase());
  }
  override _flush(done: TransformCallback): void { done(null, "!" + this.label); }
}
class Collect extends Writable {
  text: string = "";
  override _write(chunk: Buffer | string, encoding: BufferEncoding, done: (error?: Error | null) => void): void { this.text += chunk.toString(); done(); }
}
const upper = new Upper("end"), collect = new Collect();
const written: Promise<void> = pipeline(upper, collect);
for (let i = 0; i < 40; i++) upper.write("ab");
upper.end("c");
await written;
console.log(collect.text.length, collect.text.slice(-6), upper.chunks, upper.label, upper.writableFinished, collect.writableFinished);
console.log(upper instanceof Transform, upper instanceof Writable, Object.keys(upper).includes("chunks"), Object.keys(collect).includes("text"));
