"use strict";
const clock = require("./clock/index.js");
console.log(clock.locale(process.argv[2] ?? "fr"), clock.say(), clock.locale("de"), clock.say(), clock.locale("xx"));
