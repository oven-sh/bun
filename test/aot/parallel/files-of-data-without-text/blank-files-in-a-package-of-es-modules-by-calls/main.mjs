const show = (value) => typeof value + " " + JSON.stringify(value);
{
  const all = await import("./blank.jsonc");
  console.log("jsonc", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./blank.json5");
  console.log("json5", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./blank.toml");
  console.log("toml", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./blank.yaml");
  console.log("yaml", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./blank.yml");
  console.log("yml", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./blank.markdown");
  console.log("markdown", show(all.default), Object.keys(all).join());
}
{
  const all = await import("./blank.txt");
  console.log("txt", show(all.default), Object.keys(all).join());
}
