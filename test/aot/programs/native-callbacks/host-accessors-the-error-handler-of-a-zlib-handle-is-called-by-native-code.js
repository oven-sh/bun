// node:zlib stores its error handler on the native handle. Native code calls it for input that is no gzip stream, and the listener of the program gets a code that is a string.
const zlib = require("node:zlib");
const log = [];
class Seen { constructor() { this.code = 0; } note(code) { this.code = code; return typeof this.code; } }
const seen = new Seen(); log.push(seen.note(1));
const stream = zlib.createGunzip();
stream.on("error", error => { log.push(seen.note(error.code), String(error.errno), error.constructor.name); console.log(log.join("; ")); });
stream.end(Buffer.from("this is no gzip stream"));
