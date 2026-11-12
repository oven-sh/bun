// exports 1
try { console.log("exports", String(require("./m.mjs").v)); } catch (e) { console.log("throws", e.code ?? e.name); }
