import { pipeline, Readable, Transform, Writable } from "node:stream";
const seen = [];
pipeline(
  Readable.from(["a", "b"]),
  new Transform({
    transform(chunk, encoding, done) {
      done(null, chunk.toString().toUpperCase());
    },
  }),
  new Writable({
    write(chunk, encoding, done) {
      seen.push(chunk.toString());
      done();
    },
  }),
  error => console.log(error === undefined, seen.join()),
);
