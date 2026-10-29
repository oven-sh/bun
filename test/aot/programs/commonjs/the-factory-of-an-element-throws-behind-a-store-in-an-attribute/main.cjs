// The factory of an element throws behind a store in an attribute.
const held = require("./held.cjs");
try { require("./m.jsx"); } catch (e) { console.log("caught", e.message); }
console.log(JSON.stringify(held.m), held.peek());
