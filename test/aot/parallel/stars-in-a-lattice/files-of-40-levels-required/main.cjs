// 40 levels of files as TypeScript emits barrels for CommonJS, and the top is required.
// COUNT: counter:StarsRecorded = 160
// COUNT: counter:StarsCarriedOutLate = 0
"use strict";
const left = require("./left-40.cjs"), right = require("./right-40.cjs");
console.log(left.first, left.second, right.first, left.missing === undefined, left.__esModule);
