import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

class Box { constructor() { this.secret = 1; } }
const keeper = Object.create(null, { y: { set(v) { v.later = 5; } } });
const box = new Box(); keeper.y = box;
console.log(Object.keys(box).join(), box.later, keepImports);
