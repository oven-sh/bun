// Callbacks handed over and methods found through instances: node:stream calls _write, _transform, _final, _destroy and _read of subclasses: in object mode a chunk is anything, and destroy passes on whatever it was given.
import { Transform, Writable } from "node:stream";

let total = 0;

class Collect extends Writable {
  constructor() {
    super({ objectMode: true });
  }
  _write(chunk: Buffer, encoding: string, done: (error?: Error | null) => void): void {
    total += Buffer.isBuffer(chunk) ? 1 : typeof chunk === "string" ? 100 : typeof chunk === "number" ? 10000 : 1000000;
    done();
  }
  _final(done: () => void): void {
    total += typeof done === "function" ? 100000000 : 0;
    done();
  }
  _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    total += error === null ? 1000000000 : 2000000000;
    done(null);
  }
}

class Twice extends Transform {
  constructor() {
    super({ objectMode: true });
  }
  _transform(chunk: number, encoding: string, done: (error: null, result: unknown) => void): void {
    done(null, typeof chunk === "number" ? chunk * 2 : chunk);
  }
}

const collect = new Collect();
const twice = new Twice();
twice.pipe(collect);
twice.write(Buffer.from("b"));
twice.write("text");
twice.write(21);
twice.write({ plain: true });
twice.end();
collect.on("close", () => console.log(total));
