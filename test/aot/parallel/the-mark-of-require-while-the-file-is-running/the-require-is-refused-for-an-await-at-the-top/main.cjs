let lib;
try { lib = require("./lib.mjs"); } catch (error) { console.log("SAID refused", error.name); }
import("./lib.mjs").then(ns => console.log("SAID imported", typeof ns.__esModule, ns.later()));
