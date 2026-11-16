const unseen = x => [x][JSON.parse("0")];
const path = require("node:path");
path[unseen("added")] = class Added { toString() { return "added"; } };
const again = require("node:path");
console.log(String(new again.added()), again === path, typeof again[unseen("sep")]);
