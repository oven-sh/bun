const unseen = (x) => [x][JSON.parse("0")];
const say = (error) => console.log(error.name, error.code, String(error.message).split(" from ")[0].split("\n")[0]);
Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /[ab]\.mjs$/ }, (args) => ({ path: args.path.split("/").pop(), namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "export default " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const name = unseen("a");
await import(import.meta.dir + "/" + name + ".mjs").then((it) => console.log(it.default), say);
