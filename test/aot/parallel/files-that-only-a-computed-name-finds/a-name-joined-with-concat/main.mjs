// Env: NAMES=a,b
for (const name of process.env.NAMES.split(",")) {
  const plugin = await import("./plugins/".concat(name, ".ts"));
  console.log(plugin.mark);
}
