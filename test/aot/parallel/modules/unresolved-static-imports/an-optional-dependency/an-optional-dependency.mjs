const show = e =>
  console.log(
    [e.name, e.message, e.code, e.referrer, e.specifier, e.importKind].join(" | ").replaceAll(import.meta.dir, "<dir>"),
  );
console.log("entry begins");
await import("./sub/importer.mjs").catch(show);
console.log("entry goes on");
