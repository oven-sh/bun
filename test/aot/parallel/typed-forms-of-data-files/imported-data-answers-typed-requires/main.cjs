// A require() under a type of data that an import() has loaded gets the namespace that the loader holds, as in bun run.
(async () => {
  const tins = await import("./tins.json");
  const asPath = require("./tins.json", { type: "file" });
  console.log(asPath === tins, Object.keys(asPath).join(), asPath.default.red);
  const boxes = await import("./boxes.json");
  const asData = require("./boxes.json", { type: "json" });
  console.log(asData === boxes, Object.keys(asData).join());
  const note = await import("./note.txt");
  const asText = require("./note.txt", { type: "text" });
  console.log(asText === note, typeof asText.default);
})();
