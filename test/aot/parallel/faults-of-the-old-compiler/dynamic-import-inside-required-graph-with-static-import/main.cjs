// Inside an ES module graph that require() loads, the file that calls import() as text runs before the file with the static import as TOML. The call gets the TOML module.
// The plain executable has either type: it parses the two files side by side, and whichever is done first decides. A compiled one lets the statement go first, as `bun run` does.
const { pending, conf } = require("./both.mjs");
pending.then(loaded => console.log(typeof loaded.default, Object.keys(loaded).sort().join(), loaded.default === conf));
