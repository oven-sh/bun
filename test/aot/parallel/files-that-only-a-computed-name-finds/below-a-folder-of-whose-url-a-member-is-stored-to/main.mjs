const pick = name => (process.argv.length > 9 ? process.argv[9] : name);
async function report(way, load) {
  let said;
  try { said = (await load()).said; } catch (error) { said = error.code; }
  console.log(way + ":", said);
}
{
  const folder = new URL("./plugins/", import.meta.url);
  folder.search = "";
  await report("the query is emptied", () => import(new URL(pick("first") + ".mjs", folder).href));
}
{
  const folder = new URL("./plugins/", import.meta.url);
  if (process.env.MADE_UP_PLUGINS) folder.pathname = process.env.MADE_UP_PLUGINS;
  await report("another folder only where the environment names one", () => import(new URL(pick("first") + ".mjs", folder).href));
}
