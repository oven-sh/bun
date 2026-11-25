Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^\.\/(a|b|c)\.(mjs|cjs|json)$/ }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "export default " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const count = process.argv.length;
const pick = count > 6 ? "./c.mjs" : count > 5 ? "./b.mjs" : "./a.mjs";
console.log((await import(pick)).default);
