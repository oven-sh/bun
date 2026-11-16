// One file, one made name, four written types, and nothing else names the file: three types cannot read it and throw, `type: "text"` behind them answers the string, as under `bun <file>`.
// The build gave all four sites the form of the first, so the form under "text" was not in the executable: "ENOENT reading".
const name = JSON.parse('"odd.txt"');
const say = (type, load) => load().then(it => console.log(type, typeof it.default, JSON.stringify(it.default)), () => console.log(type, "threw"));
await say("toml", () => import("./data/" + name, { with: { type: "toml" } }));
await say("json5", () => import("./data/" + name, { with: { type: "json5" } }));
await say("xml", () => import("./data/" + name, { with: { type: "xml" } }));
await say("text", () => import("./data/" + name, { with: { type: "text" } }));
