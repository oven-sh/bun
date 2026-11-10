const { plugins } = { plugins: ["./one.cjs", "./two.cjs"] };
for (const plugin of plugins) console.log("SAID", require(plugin).name);
