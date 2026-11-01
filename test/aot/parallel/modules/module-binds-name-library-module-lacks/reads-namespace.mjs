import * as fs from "node:fs";
console.log("reads-namespace runs", typeof fs.existsSync, fs.absent, fs.zebra, "absent" in fs);
