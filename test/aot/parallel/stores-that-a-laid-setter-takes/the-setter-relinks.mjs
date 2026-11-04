import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

class Box { constructor() { this.secret = 1; } peek() { return this.secret; } }
const keeper = Object.create(null, { y: { set(v) { Object.setPrototypeOf(v, { peek() { return "relinked"; } }); } } });
const box = new Box(); keeper.y = box;
let out = ""; for (let i = 0; i < 300; i++) out = box.peek();
console.log(out, box instanceof Box, keepImports);
