"use strict";
for (const key of Object.keys(require.cache)) require.cache[key].exports = { kA: "meddled", kB: "meddled" };
require.cache[require.resolve("./symbols.cjs")] = { exports: { kA: "stored", kB: "stored" }, loaded: true, id: "x" };
