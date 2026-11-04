import * as ns from "./owner.mjs";
console.log(Object.keys(ns).join());
try { console.log(ns.x()); } catch (error) { console.log(error.constructor.name + ": " + String(error.message).slice(0, 60)); }
