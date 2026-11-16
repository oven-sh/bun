module.exports = ask => {
  ask("own", () => require("./nothing.json"));
  ask("module", () => module.require("./nothing.json"));
  const held = require;
  ask("held in commonjs", () => held("./nothing.json"));
  ask("resolve", () => require.resolve("./nothing.json").split("/").pop());
};
