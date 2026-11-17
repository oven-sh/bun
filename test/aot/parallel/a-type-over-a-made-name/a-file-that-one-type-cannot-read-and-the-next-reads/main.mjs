// The failure of one written type stays with that type: the next type that asks for the file under a made name reads it, and what it reads answers the types behind it, as under `bun <file>`.
// The executable noted the form that cannot be read as the one that answered first, and gave its failure to every type behind it: `type: "text"` threw.
const [odd, toml] = JSON.parse('["odd.txt", "bad.toml"]');
const say = (label, load) =>
  load().then(
    it => console.log(label, typeof it.default, JSON.stringify(it.default)),
    () => console.log(label, "threw"),
  );
await say("toml", () => import("./data/" + odd, { with: { type: "toml" } }));
await say("json5", () => import("./data/" + odd, { with: { type: "json5" } }));
await say("xml", () => import("./data/" + odd, { with: { type: "xml" } }));
await say("toml again", () => import("./data/" + odd, { with: { type: "toml" } }));
await say("text", () => import("./data/" + odd, { with: { type: "text" } }));
await say("toml behind text", () => import("./data/" + odd, { with: { type: "toml" } }));
await say("its own loader", () => import("./data/" + toml));
await say("its own type", () => import("./data/" + toml, { with: { type: "toml" } }));
