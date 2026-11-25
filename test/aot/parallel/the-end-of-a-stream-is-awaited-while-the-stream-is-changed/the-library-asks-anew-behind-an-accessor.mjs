import { Duplex, Readable, Writable, finished, isReadable, isWritable } from "node:stream";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
async function watch(title, stream) {
  let said = "nothing yet";
  finished(stream, error => {
    said = error ? (error.code ?? error.message) : "ended";
  });
  await settle();
  lines.push(title + ": " + said);
}

for (const takes of [false, true]) {
  const word = takes ? " changes the stream" : " leaves all as it is";
  {
    let asks = 0;
    class Pool extends Readable {
      get readable() {
        if (++asks === 2 && takes) this.pipe = undefined;
        return true;
      }
    }
    const pool = new Pool({ autoDestroy: false, read() { this.push(null); } });
    pool.resume();
    await settle();
    asks = 0;
    lines.push("readable, asked a second time," + word + ": " + isReadable(pool));
  }
  {
    let asks = 0;
    class Sink extends Writable {
      get writable() {
        if (++asks === 2 && takes) this.write = undefined;
        return true;
      }
    }
    const sink = new Sink({ autoDestroy: false, write(chunk, encoding, done) { done(); } });
    sink.end();
    await settle();
    asks = 0;
    lines.push("writable, asked a second time," + word + ": " + isWritable(sink));
  }
  {
    let armed = false;
    class Hose extends Duplex {
      get writableErrored() {
        if (armed) {
          armed = false;
          this.write = undefined;
          this.pipe = undefined;
          this._readableState = undefined;
          this._writableState = undefined;
          Object.defineProperty(this, "readableErrored", { value: new Error("left behind") });
        }
        return null;
      }
    }
    const hose = new Hose({ read() {}, write(chunk, encoding, done) { done(); } });
    hose.destroy();
    await settle();
    armed = takes;
    await watch("writableErrored of a closed stream" + word, hose);
  }
  {
    let armed = false;
    const ended = new Readable({ autoDestroy: false, read() { this.push(null); } });
    ended.resume();
    await settle();
    class Pool extends Readable {
      get pause() {
        if (armed) {
          armed = false;
          this.pipe = undefined;
          this._readableState = ended._readableState;
        }
        return super.pause;
      }
    }
    const pool = new Pool({ read() {} });
    pool.destroy();
    await settle();
    armed = takes;
    await watch("pause of a closed stream" + word, pool);
  }
}
console.log(lines.join("\n"));
