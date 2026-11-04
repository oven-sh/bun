import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

class Box { constructor() { this.secret = 1; } }
const keeper = Object.create(null, { y: { set(v) { delete v.secret; } } });
const box = new Box(); keeper.y = box;
function read(b) { return typeof b.secret + ":" + ("secret" in b); }
let out = ""; for (let i = 0; i < 300; i++) out = read(box);
console.log(out, keepImports);
