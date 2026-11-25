// A statement asks for a file under a type that cannot read it: the file that holds the statement fails to load, as under `bun <file>`, whatever types stand over made names elsewhere.
// The build gave the statement the form of the first made name's type: `type: "text"`: the statement's file loaded, and its value was the text.
const odd = JSON.parse('"odd.txt"');
const say = (label, load) =>
  load().then(
    it => console.log(label, typeof it.default, JSON.stringify(it.default)),
    () => console.log(label, "threw"),
  );
await say("the file with the statement", () => import("./holder.mjs"));
await say("text", () => import("./data/" + odd, { with: { type: "text" } }));
await say("the file with the statement again", () => import("./holder.mjs"));
await say("toml behind text", () => import("./data/" + odd, { with: { type: "toml" } }));
