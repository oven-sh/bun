import * as fs from "node:fs";
console.log("ran", typeof fs.noSuchExport, "noSuchExport" in fs);
