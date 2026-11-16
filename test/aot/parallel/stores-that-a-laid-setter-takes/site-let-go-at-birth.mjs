import http from "node:http";
import fs from "node:fs";
import stream from "node:stream";
import util from "node:util";

const holder = Object.create(null, {
  x: { set(v) { try { console.log(v("a")); } catch { console.log("threw"); } } },
});
holder.x = function tail(text) { return text + "b"; };

class Box { constructor() { this.secret = 1; } }
const keeper = Object.create(null, { y: { set(v) { v.secret = "text"; } } });
const box = new Box();
keeper.y = box;
console.log(typeof box.secret, box.secret + 1);
console.log(typeof http.createServer, typeof fs.readFileSync, typeof stream.Readable, typeof util.inspect);
