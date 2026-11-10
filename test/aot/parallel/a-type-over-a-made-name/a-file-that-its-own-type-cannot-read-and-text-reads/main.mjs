// A file that its own loader cannot read is read under `type: "text"` behind it, as under `bun <file>`.
const toml = JSON.parse('"bad.toml"');
const say = (label, load) => load().then(() => console.log(label, "read"), () => console.log(label, "threw"));
await say("its own type", () => import("./data/" + toml, { with: { type: "toml" } }));
console.log("behind it:");
await import("./data/" + toml, { with: { type: "text" } }).then(() => console.log("read"), () => console.log("threw"));
