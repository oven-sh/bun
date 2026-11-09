// Reference: bun build --compile
const show = (value) => typeof value + " " + JSON.stringify(value);
{
  const all = await import("./nothing.jsonc");
  console.log("jsonc", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./nothing.json5");
  console.log("json5", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./nothing.toml");
  console.log("toml", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./nothing.yaml");
  console.log("yaml", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./nothing.yml");
  console.log("yml", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./nothing.markdown");
  console.log("markdown", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./nothing.txt");
  console.log("txt", show(all.default), Object.keys(all).join());
}
