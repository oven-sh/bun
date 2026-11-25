Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^\.\/(a|b)\.mjs$/ }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "export default " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const one = "./a.mjs";
const pick = process.argv.length > 5 ? "./b.mjs" : "./a.mjs";
console.log((await import(one)).default);
console.log((await import(pick)).default);
