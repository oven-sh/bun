const { Stats, Dirent } = require("node:fs");
for (const f of [Stats, Dirent])
  console.log(
    Object.getOwnPropertyNames(f).join(),
    f.name,
    f.length,
    JSON.stringify(Object.getOwnPropertyDescriptor(f, "name")),
  );
