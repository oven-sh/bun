for (const turn of [1, 2]) try { require("./lib.mjs"); } catch (error) { console.log("SAID", turn, error.name, typeof globalThis.kept.__esModule); }
