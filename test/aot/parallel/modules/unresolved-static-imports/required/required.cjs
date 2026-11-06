const show = e =>
  console.log(
    [e.name, e.message, e.code, e.referrer, e.specifier, e.importKind].join(" | ").replaceAll(module.path, "<dir>"),
  );
try {
  require("./sub/importer.mjs");
} catch (e) {
  show(e);
}
console.log("entry goes on");
