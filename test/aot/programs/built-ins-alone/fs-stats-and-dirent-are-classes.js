import fs from "node:fs";
console.log(typeof fs.Stats, typeof fs.Dirent, fs.statSync(".") instanceof fs.Stats);
