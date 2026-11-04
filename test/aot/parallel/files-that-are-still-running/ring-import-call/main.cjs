"use strict";
const ledger = require("./ledger.cjs");
Promise.all([ledger.first, ledger.second]).then((answers) => console.log(answers.join(" ")));
