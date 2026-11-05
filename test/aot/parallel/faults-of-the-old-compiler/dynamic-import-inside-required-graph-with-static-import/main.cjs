// Inside an ES module graph that require() loads, the file that calls import() as text runs before the file with the static import as TOML. The call gets the TOML module.
const { pending, conf } = require("./both.mjs");
pending.then(loaded => console.log(typeof loaded.default, Object.keys(loaded).sort().join(), loaded.default === conf));
