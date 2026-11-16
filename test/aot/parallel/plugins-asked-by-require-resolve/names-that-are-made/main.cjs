const last = (text) => String(text).split("/").pop();
Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /[ab]\.cjs$/ }, (args) => ({ path: args.path.split("/").pop(), namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, (args) => ({ contents: "module.exports = " + JSON.stringify("plugin " + args.path), loader: "js" }));
  },
});
const pick = process.argv.length > 5 ? "./b.cjs" : "./a.cjs";
const one = "./a.cjs";
const name = "a";
console.log(last(require.resolve(`./${name}.cjs`)), last(require.resolve("./" + name + ".cjs")), last(require.resolve(__dirname + "/a.cjs")), last(require.resolve(["./a", "cjs"].join("."))), last(require.resolve(process.argv.length > 5 ? "./b.cjs" : "./a.cjs")));
