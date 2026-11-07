// Several written types over one made name: the type that RUNS first answers the types behind it, where it can read the file, as under `bun <file>`.
// The build gave every such site the form of the site that is WRITTEN first: the other forms were not in the executable ("ENOENT reading").
const [both, three] = JSON.parse('["both.txt", "three.txt"]');
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
  toml: () => import("./data/" + three, { with: { type: "toml" } }),
  yaml: () => import("./data/" + three, { with: { type: "yaml" } }),
  text: () => import("./data/" + three, { with: { type: "text" } }),
};
for (const type of JSON.parse('["yaml", "text", "toml"]')) await say(type, roads[type]);
