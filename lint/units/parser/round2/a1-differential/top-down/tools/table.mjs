// usage: node table.mjs <diff.txt>...   one line per row of the tables: mark, class, records, sources, cause, first example
import { readFileSync } from "node:fs";
for (const path of process.argv.slice(2)) {
  const lines = readFileSync(path, "utf8").split("\n");
  console.log(`# ${path.split("/").pop()}: ${lines[0]} | ${lines[1]} | ${lines[2]}`);
  for (let i = 3; i < lines.length; i++) {
    const m = /^(!!|\?\?|  ) +(\d+) records +(\d+) sources  (\S+) +(.*)$/.exec(lines[i]);
    if (!m) continue;
    let ex = "";
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const e = /^ {14}(\S+) +(".*")$/.exec(lines[j]);
      if (e) { ex = `${e[2]}`; break; }
    }
    console.log([m[1].trim() || "ok", m[4], m[2], m[3], m[5], ex.slice(0, 110)].join("\t"));
  }
  console.log(lines[lines.length - 2] || lines[lines.length - 1]);
}
