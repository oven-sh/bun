// A data file that cannot be read under the written type throws at the import an error of the class that `bun <file>` throws, whether the path starts with a folder or with nothing.
// The module that stands for such a file was refused to the loader, which an import with a type goes through: "this executable can't load a module from a dynamic path".
// The executable holds nothing of such a file, and the build does not list it.
// Build prints: 2 x note: TS100088: This path isn't a constant, so the executable embeds every file that it may name. These aren't code: data/good.json
const names = JSON.parse('["good.json", "comma.json", "comment.jsonc"]');
const underFolder = name => import("./data/" + name, { with: { type: "json" } });
const underNothing = path => import("./" + path, { with: { type: "json" } });
for (const name of names) {
  for (const load of [() => underFolder(name), () => underNothing(["data", name].join("/"))]) {
    try {
      console.log(name, JSON.stringify((await load()).default));
    } catch (error) {
      console.log(name, error.name);
    }
  }
}
