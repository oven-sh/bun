// Methods of node: modules called through `import * as`: the namespace object is `this` of every call.
// COUNT: operation:operationAOTGetModuleNamespace <= 8
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "os";
import * as util from "node:util";
declare const process: any; declare const console: any;
function names(name: string): number { return path.basename(name).length + path.extname(name).length; }
let sum = 0;
const turns = Number(process.argv[2] ?? 1000);
for (let i = 0; i < turns; i++) sum += names("a/b" + (i & 7) + ".ts");
console.log(sum, fs.existsSync("."), typeof os.hostname(), util.format("%s", 1));
// What a callee sees as `this`, and that it is one object.
const seen: unknown[] = [];
const kept = fs.existsSync;
(fs as any).default.existsSync = function (this: unknown) { seen.push(this); return true; };
function ask(): boolean { return fs.existsSync("nowhere at all"); }
console.log(ask(), ask(), seen.length, seen[0] === seen[1], seen.length ? seen[0] === fs : "the export is not replaced");
(fs as any).default.existsSync = kept;
console.log(Object.prototype.toString.call(fs), Object.isFrozen(path), Object.keys(os).length > 10);
