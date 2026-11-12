console.log("SAID body of tax");
"use strict";
exports.rate = arguments.length;
exports.fee = () => require(__filename).rate;
exports.show = () => __dirname.length > 0;
