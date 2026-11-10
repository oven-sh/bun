"use strict";
try { require("./lib.cjs"); } catch (e) { console.log(e.message); }
console.log(+(process.argv[2] ?? 1));
