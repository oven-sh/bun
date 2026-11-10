// One file written under a type that cannot read it and under "text": the first import throws, the second answers the string, and what it read answers the types behind it, as under `bun <file>`.
// `bun build --compile` stops at such a program. The build with --aot gives the written types of one file the form of the first, as the bundler does: here that form only throws, and "text" threw with it.
const say = (label, load) =>
  load().then(
    it => console.log(label, typeof it.default, JSON.stringify(it.default)),
    error => console.log(label, error.name),
  );
await say("toml", () => import("./data/odd.txt", { with: { type: "toml" } }));
await say("text", () => import("./data/odd.txt", { with: { type: "text" } }));
await say("toml again", () => import("./data/odd.txt", { with: { type: "toml" } }));
await say("four types: toml", () => import("./data/four.txt", { with: { type: "toml" } }));
await say("four types: json5", () => import("./data/four.txt", { with: { type: "json5" } }));
await say("four types: xml", () => import("./data/four.txt", { with: { type: "xml" } }));
await say("four types: text", () => import("./data/four.txt", { with: { type: "text" } }));
const between = JSON.parse('"between.txt"');
await say("a made name between: written toml", () => import("./data/between.txt", { with: { type: "toml" } }));
await say("a made name between: made toml", () => import("./data/" + between, { with: { type: "toml" } }));
await say("a made name between: written text", () => import("./data/between.txt", { with: { type: "text" } }));
const asToml = () => import("./data/later.txt", { with: { type: "toml" } });
await say("the failing type is written first, text runs first", () => import("./data/later.txt", { with: { type: "text" } }));
void asToml;
