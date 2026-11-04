import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

const holder = Object.create({}, { tag: { value: "t" } });
holder.run = function tail(text) { return text + "b"; };
const unseen = (0, eval)("(o) => o.run('a')");
let out; try { out = unseen(holder); } catch (e) { out = e.constructor.name + ":" + e.message; }
console.log(out, keepImports);
