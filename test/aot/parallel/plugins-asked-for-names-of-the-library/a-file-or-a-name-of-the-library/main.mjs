Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^os$/, namespace: "node" }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onResolve({ filter: /^(os|path)$/ }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "export default " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const count = process.argv.length;
const pick = count > 5 ? "./a.mjs" : "node:os";
console.log(typeof (await import(pick)).default);
const bare = count > 5 ? "./a.mjs" : "path";
console.log(typeof (await import(bare)).default);
const one = "node:os";
console.log(typeof (await import(one)).default);
const other = "path";
console.log(typeof (await import(other)).default);
