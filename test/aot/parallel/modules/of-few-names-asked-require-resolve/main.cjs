// One of a few names is asked of require resolve.
const path = require("path");
const say = (name, ask) => {
  try {
    console.log(name, ask());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
const last = found => path.basename(found);

const table = { one: "./one.cjs", two: "./two.cjs", library: "fs", prefixed: "node:path", none: "./none.cjs" };
for (const key of Object.keys(table)) say(key, () => last(require.resolve(table[key])));

const chosen = process.argv.length > 7 ? "./one.cjs" : "./two.cjs";
say("chosen", () => last(require.resolve(chosen)));
say("chosen is the file that is written out", () => require.resolve(chosen) === require.resolve("./two.cjs"));
say("chosen loads", () => require(chosen).which);

const joined = path.join(__dirname, ["one", "cjs"].join("."));
say("joined", () => last(require.resolve(joined)));
say("joined is the file that is written out", () => require.resolve(joined) === require.resolve("./one.cjs"));
say("joined loads", () => require(joined).which);
