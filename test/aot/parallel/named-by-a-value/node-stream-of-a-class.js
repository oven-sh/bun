import { Readable, Transform } from "node:stream";
class Twice extends Transform { _transform(chunk, encoding, done) { done(null, String(chunk) + String(chunk)); } _flush(done) { this.push("!"); done(); } }
let all = ""; for await (const chunk of Readable.from(["a", "b"]).pipe(new Twice())) all += chunk; console.log(all);
