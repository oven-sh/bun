import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

const kept = [];
const holder = Object.create(null, { x: { set(v) { kept.push(v); } } });
holder.x = function tail(text) { return text + "b"; };
holder.x = { note: 1, say() { return "said" + this.note; } };
let out; try { out = kept[0]("a") + kept[1].say(); } catch (e) { out = e.constructor.name + ":" + e.message; }
console.log(out, keepImports);
