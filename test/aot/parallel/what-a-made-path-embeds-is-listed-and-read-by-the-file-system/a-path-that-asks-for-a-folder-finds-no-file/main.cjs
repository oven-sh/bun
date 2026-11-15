const fs = require("node:fs");
const folder = __dirname + "/data";
const stems = (process.env.MADE_UP_STEMS ?? "a b").split(" ");
console.log(stems.map(stem => require("./data/" + stem + ".json").n).join(" "));
for (const way of ["/", "/.", "/./a.json", "/../data/b.json", "//a.json", "/a.json/", "/a.json/.", "/a.json//", "/a.json/x"]) {
  console.log(JSON.stringify(way), fs.existsSync(folder + way));
}
process.exit(0);
