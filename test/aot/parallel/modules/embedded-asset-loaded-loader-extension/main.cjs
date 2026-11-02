// Three data files are embedded with --asset, and the program asks for them by a path that the build cannot follow. Each is read by the loader of its extension, as from the disk: none is run as JavaScript.
// Flags: --asset ./data
const root = [__dirname, "data"].join("/");
const at = name => new CustomEvent("x", { detail: root + "/" + name }).detail;
for (const name of ["manifest.json", "note.txt", "settings.toml"]) console.log("require", name, JSON.stringify(require(at(name))));
(async () => {
  for (const name of ["manifest.json", "note.txt", "settings.toml"]) console.log("import", name, JSON.stringify((await import(at(name))).default));
})();
