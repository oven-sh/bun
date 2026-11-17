import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

const list = [1, 2, 3];
const keeper = Object.create(null, { y: { set(v) { v.push("text"); v[0] = "first"; } } });
keeper.y = list;
function sum(l) { let t = 0; for (let i = 0; i < l.length; i++) t += l[i]; return t; }
let out; for (let i = 0; i < 300; i++) out = sum(list);
console.log(out, typeof list[0], list.length, keepImports);
