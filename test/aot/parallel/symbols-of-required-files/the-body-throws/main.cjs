// What a CommonJS file exports is found by whoever requires it as its body left it. ONE DEED: the body throws behind its first store.
"use strict";
for (let i = 0; i < 2; i++) { try { const { kA, kB } = require("./symbols.cjs"); console.log(String(kA), String(kB)); } catch (e) { console.log(e.message); } globalThis.throws = false; }
