// An imported CommonJS file requires its importer back, which fails, and the file does not catch the error. The link that came while the file ran has copied its exports, which runs the getter once. The file made no record of its own, so nothing copies them again.
await import("./root.mjs").catch(error => console.log("import throws", error.name));
