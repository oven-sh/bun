const make = require("./index.cjs");
console.log(typeof make, make.early, make({ step: 4 }).twice());
