// Todo: "false" | "true": src/js/node/fs.ts names Dirent and Stats anew only where it is not compiled
const Stats = (await Bun.file(import.meta.path).stat()).constructor;
delete Stats.name;
const fs = await import("node:fs");
console.log(fs.Stats === Stats ? "same" : "other", Object.hasOwn(Stats, "name"));
