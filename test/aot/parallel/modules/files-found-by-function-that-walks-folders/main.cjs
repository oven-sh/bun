// A function lists a folder beside the program, calls itself for each folder that it finds there and loads each file.
const fs = require("node:fs");
const path = require("node:path");

const found = [];
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) found.push(require(full));
  }
}
walk(path.join(__dirname, "commands"));
for (const name of found.map(command => command.data.name).sort()) console.log(name);
