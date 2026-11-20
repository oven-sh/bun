// writev() writes to its own stream. What it writes goes out after the chunks that it was given, whether it calls back at once or later, and starts at any place in the list of waiting writes. What it writes after it has called back goes out behind that.
// With nothing in front of it, or after writev() has thrown, it goes out at once. Empty chunks alone do not go out, and do not keep the stream from finishing. If writev() fails, what it wrote fails with it. If the stream had failed before, the callbacks of the chunks are its callbacks too.
import { once } from "node:events";
import { Writable } from "node:stream";
for (const later of [false, true]) {
  for (const behindAnother of [false, true]) {
    let rounds = 0;
    const stream = new Writable({
      write(chunk, encoding, done) {
        console.log("write " + chunk);
        if (String(chunk) !== "first") return done();
        stream.write("a");
        stream.write("b");
        setImmediate(done);
      },
      final(done) {
        done();
      },
      writev(chunks, done) {
        if (++rounds === 1) stream.write("c", () => console.log("callback c"));
        if (rounds <= 2) stream.write("d", () => stream.end());
        if (rounds === 2) stream.write("e");
        if (rounds === 3) stream.write("");
        console.log("writev " + chunks.map(it => it.chunk).join() + " waiting " + stream.writableLength);
        if (later) setImmediate(done);
        else done();
      },
    });
    stream.cork();
    if (behindAnother) stream.write("first");
    else for (const chunk of ["a", "b"]) stream.write(chunk);
    stream.uncork();
    await once(stream, "finish");
    console.log("finish " + stream.writableLength);
  }
  for (const failedBefore of [false, true]) {
    const stream = new Writable({
      write(chunk, encoding, done) {
        console.log("write " + chunk);
        setImmediate(done, new Error("write failed"));
      },
      writev(chunks, done) {
        for (const chunk of ["c", "d"]) stream.write(chunk, error => console.log(chunk + " " + error?.message));
        console.log("writev " + chunks.map(it => it.chunk).join());
        const error = failedBefore ? null : new Error("writev failed");
        if (later) setImmediate(done, error);
        else done(error);
      },
    });
    if (failedBefore) stream.write("first");
    else stream.cork();
    stream.write("a", () => {
      if (!failedBefore) return;
      stream.cork();
      stream.uncork();
    });
    stream.write("b");
    stream.uncork();
    console.log("error " + (await once(stream, "error"))[0].message);
    await new Promise(resolve => setImmediate(resolve));
    console.log("waiting " + stream.writableLength);
  }
}
for (const how of ["writes", "writes twice", "writes empty chunks", "throws"]) {
  let first = true;
  const stream = new Writable({
    write(chunk, encoding, done) {
      console.log("write " + chunk);
      done();
    },
    writev(chunks, done) {
      console.log("writev " + chunks.map(it => it.chunk).join());
      if (!first) return done();
      first = false;
      if (how === "writes twice") stream.write("c");
      if (how === "writes empty chunks") {
        stream.write("");
        stream.write("");
      }
      done();
      if (how === "writes" || how === "writes twice") stream.write("d");
      if (how === "throws") throw new Error("thrown");
      console.log("returns");
    },
  });
  stream.on("finish", () => console.log("finish"));
  for (let round = how === "throws" ? 2 : 1; round > 0; round--) {
    stream.cork();
    stream.write("a");
    stream.write("b");
    try {
      stream.uncork();
    } catch (error) {
      console.log((error as Error).message);
    }
  }
  stream.end("last");
  await new Promise(resolve => setImmediate(resolve));
  console.log(how, stream.writableLength);
}
