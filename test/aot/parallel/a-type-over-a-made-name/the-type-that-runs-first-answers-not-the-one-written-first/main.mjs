// Several written types over one made name: the type that RUNS first and can read the file answers the types behind it, as under `bun <file>`.
// The build gave every such site the form of the site that is WRITTEN first, as the bundler does for a written name. It links no made name: the other forms were not in the executable ("ENOENT reading").
const [both, loop] = JSON.parse('["both.txt", "loop.txt"]');
const say = (label, load) =>
  load().then(
    it => console.log(label, typeof it.default, JSON.stringify(it.default)),
    () => console.log(label, "threw"),
  );
const asText = () => import("./data/" + both, { with: { type: "text" } });
const asYaml = () => import("./data/" + both, { with: { type: "yaml" } });
await say("yaml, written second, runs first", asYaml);
await say("text behind it", asText);
const roads = {
  toml: () => import("./data/" + loop, { with: { type: "toml" } }),
  yaml: () => import("./data/" + loop, { with: { type: "yaml" } }),
  text: () => import("./data/" + loop, { with: { type: "text" } }),
};
for (const type of JSON.parse('["toml", "yaml", "text", "toml"]')) await say(type, roads[type]);
