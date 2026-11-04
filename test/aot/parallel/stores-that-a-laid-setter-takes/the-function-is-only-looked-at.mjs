import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

let got = "never";
const holder = Object.create(null, { x: { set(v) { got = typeof v + ":" + v.name + ":" + v.length; } } });
holder.x = function tail(text) { return text + "b"; };
console.log(got, keepImports);
