let lib; try { lib = require("./lib.mjs"); } catch (e) { console.log("SAID refused", e.name); }
import("./lib.mjs").then(ns => console.log("SAID behind", typeof ns.__esModule, ns.later()), e => console.log("SAID rejected", e.name));
