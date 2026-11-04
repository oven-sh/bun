import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

function tail(n) { return n + 1; }
let t = 0; for (let i = 0; i < 300; i++) t += tail(i);
let got;
const holder = Object.create(null, { x: { set(v) { got = v("a"); } } });
holder.x = tail;
console.log(t, typeof got, got, keepImports);
