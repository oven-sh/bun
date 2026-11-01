// Patterns made at run time, as the `ignore` package makes them from the lines of a .gitignore, over paths of up to 300 folders.
// `(?:^|\/)[^\/]*\.log(?=$|\/$)` stops at every slash and walks a folder's name. Once its attempts have come far without a match, the matcher looks for `.log` in the rest and gives up where it is missing.
const nothing = String(Date.now()).slice(99);
const sources = [
  "(?:^|\\/)[^\\/]*\\.log(?=$|\\/$)",
  "(?:^|\\/)[^\\/]*\\.min\\.js(?=$|\\/$)",
  "(?:^|\\/)node_modules(?=$|\\/$)",
  "^(?:.*\\/)?\\.cache(?=$|\\/$)",
  "^(?:.*\\/)?tmp\\/.+(?=$|\\/$)",
  "^src(?:\\/[^\\/]+)*\\/generated\\/[^\\/]*\\.ts(?=$|\\/$)",
  "\\/[^\\/]*\\.log|9x+$",
  "\\/[^\\/]*(?:\\.log)?$",
];
const tails = [
  "",
  "/",
  "/a.log",
  "/a.LOG/",
  "/a.logs",
  "/a.log/b",
  "/x.min.js",
  "/node_modules",
  "/.cache/",
  "/tmp/a",
  "/generated/a.ts",
  ".log",
];
function folders(count, filler) {
  const parts = [];
  for (let depth = 0; depth < count; depth++)
    parts.push((depth % 10) + filler.repeat(6));
  return parts.join("/");
}
for (const flags of ["", "i", "g", "u"]) {
  for (const source of sources) {
    const pattern = new RegExp(source + nothing, flags);
    const found = [];
    for (const filler of ["x", "Ж"]) {
      for (const count of [1, 16, 31, 32, 33, 40, 300]) {
        for (const head of ["", "src/"]) {
          for (const tail of tails) {
            pattern.lastIndex = 0;
            const match = pattern.exec(head + folders(count, filler) + tail);
            found.push(match ? match.index + ":" + match[0].length : "-");
          }
        }
      }
    }
    console.log(flags || "no flags", source, found.join(" "));
  }
}
const long = folders(300, "x");
console.log(
  long.replace(new RegExp("\\/[^\\/]*\\.log" + nothing, "g"), "").length,
  (long + "/a.log" + long + "/b.log").match(
    new RegExp("\\/[^\\/]*\\.log" + nothing, "g"),
  ),
);
console.log(
  (long + "/a.log").split(new RegExp("\\/[^\\/]*\\.log" + nothing)).length,
  (long + "/a.log").search(new RegExp("\\/[^\\/]*\\.LOG" + nothing, "i")),
);
