const show = e =>
  console.log(
    [e.name, e.message, e.code, e.referrer, e.specifier, e.importKind].join(" | ").replaceAll(import.meta.dir, "<dir>"),
  );
await import("./sub/importer.mjs").catch(show);
await import("./sub/importer.mjs").catch(show);
await import("./sub/first.mjs");
