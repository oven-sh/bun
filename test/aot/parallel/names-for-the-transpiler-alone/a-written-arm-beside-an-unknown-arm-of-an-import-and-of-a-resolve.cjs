// The transpiler gives each arm of the name an import() or a require.resolve() of its own too, and reads the arms that are written: `flag === 1 ? import("os") : import(maybe)`.
// The whole name was taken for unknown, and the loader knows no "bun:os": both failed.
const flag = process.argv.length > 5 ? 2 : 1;
const maybe = process.env.NO_SUCH_VARIABLE_HERE;
const made = JSON.parse('"bun:os"');
const say = async (name, load) => {
  let got;
  try {
    const loaded = await load();
    got = typeof loaded === "string" ? loaded : typeof loaded.cpus;
  } catch (error) {
    got = "THROWS " + error.code;
  }
  console.log(name, got);
};
(async () => {
  await say("import, an arm beside an unknown", () => import(flag === 1 ? "bun:os" : maybe));
  await say("import, an arm behind an unknown", () => import(flag === 2 ? maybe : "bun:os"));
  await say("import, an arm in an arm", () => import(flag === 2 ? maybe : flag === 1 ? `bun:os` : maybe));
  await say("import, the unknown arm makes the same text", () => import(flag === 2 ? "bun:os" : made));
  await say("resolve, an arm beside an unknown", () => require.resolve(flag === 1 ? "bun:os" : maybe));
  await say("resolve, an arm behind an unknown", () => require.resolve(flag === 2 ? maybe : `bun:os`));
  await say("resolve, an arm in an arm", () => require.resolve(flag === 2 ? maybe : flag === 1 ? "bun:os" : maybe));
  await say("resolve reads no arm that is joined", () => require.resolve(flag === 1 ? "bun:" + "os" : maybe));
  await say("import reads an arm that is joined", () => import(flag === 1 ? "bun:" + "os" : maybe));
  await say("resolve, the unknown arm makes the same text", () => require.resolve(flag === 2 ? "bun:os" : made));
  await say("resolve under another name", () => { const load = require; return load.resolve(flag === 1 ? "bun:os" : maybe); });
})();
