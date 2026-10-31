// Each loop asks node:path one thing about four paths in turn.
import { basename, dirname, extname, isAbsolute } from "node:path";
const directories = [
  "/Users/someone/projects/application/src/components",
  "/home/user/config/tool/settings/of/the/day",
  "/usr/local/lib/node_modules/typescript/lib",
  "/var/www/sites/example/releases/current/public",
];
const names = ["button/index.tsx", "file.json", "typescript.js", "assets/app.css"];
const files = directories.map((directory, i) => directory + "/" + names[i]);
// isAbsolute leaves a rope as it is. dirname makes it one piece.
for (const file of files) dirname(file);
const loops = {
  isAbsolute(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += isAbsolute(files[i & 3]) ? 1 : 0;
    return sum;
  },
  dirname(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += dirname(files[i & 3]).length;
    return sum;
  },
  basename(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += basename(files[i & 3]).length;
    return sum;
  },
  extname(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += extname(files[i & 3]).length;
    return sum;
  },
};
const which = process.argv[2] ?? "";
const turns = Number(process.argv[3] ?? "64");
if (which) console.log(which, loops[which](turns));
else for (const name in loops) console.log(name, loops[name](turns));
