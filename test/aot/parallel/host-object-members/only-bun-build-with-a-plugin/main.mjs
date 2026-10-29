// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const built = await Bun.build({
  entrypoints: ["./entry.js"],
  plugins: [
    {
      name: "text",
      setup(build) {
        build.onResolve({ filter: /^virtual$/ }, () => ({ path: "virtual", namespace: "made" }));
        build.onLoad({ filter: /.*/, namespace: "made" }, () => ({
          contents: "export default 'from a plugin'",
          loader: "js",
        }));
      },
    },
  ],
});
console.log(built.success, (await built.outputs[0].text()).includes("from a plugin"));
