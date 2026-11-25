const fs = require("node:fs");
const folder = __dirname + "/data";
const names = (process.env.MADE_UP_NAMES ?? "a sub/b").split(" ");
console.log(names.map(name => require("./data/" + name + ".json").n).join(" "));
const behindNoFolder = process.platform === "win32" ? [] : ["/none/../a.json", "/a.json/../a.json", "/sub/../none/../a.json", "/sub/b.json/../b.json"];
for (const way of ["/sub/../a.json", "/sub/../sub/b.json", ...behindNoFolder]) {
  let read;
  try {
    read = fs.readFileSync(folder + way, "utf8").trim();
  } catch (error) {
    read = "threw";
  }
  console.log(JSON.stringify(way), fs.existsSync(folder + way), read);
}
process.exit(0);
