"use strict";
const a = require("./exporter.cjs");
console.log(a.early, a.read({ a: 1 }), a.later({ b: 1 }));
