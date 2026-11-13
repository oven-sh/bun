import { Readable } from "node:stream";
let leaked = [];
Object.prototype.setFlowing = function (v) { leaked.push([Object.prototype.toString.call(this), this?.constructor?.name, v]); };
Object.prototype.setReadCallback = function (cb) { leaked.push(["setReadCallback called on", this?.constructor?.name]); return true; };
const r = Readable.fromWeb(new Blob(["hello"]).stream());
let data = "";
r.on("data", d => (data += d));
r.on("end", () => { console.log("fromWeb(Blob) data:", data, "leaked:", JSON.stringify(leaked)); });
// and a child whose stdout is already ended+buffered is harder to make; try a normal child too
import { spawn } from "node:child_process";
const c = spawn("sh", ["-c", "printf hi"]);
let out = "";
c.stdout.on("data", d => (out += d));
c.on("close", () => console.log("child out:", out, "leaked:", JSON.stringify(leaked)));
