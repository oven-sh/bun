import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";
const keepImports = [typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect].join();

const holder = Object.create({}, { tag: { value: "t" } });
holder.toJSON = function tail() { return "from-toJSON"; };
holder.toString = function text() { return "from-toString"; };
let out; try { out = JSON.stringify({ holder }) + `${holder}` + util.inspect(Object.keys(holder)); } catch (e) { out = e.constructor.name + ":" + e.message; }
console.log(out, keepImports);
