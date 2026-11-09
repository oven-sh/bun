process.on("uncaughtException", error => console.log(error.constructor.name));
console.log("start");
shapes.area;
var shapes = require("./shapes.mjs");
console.log("end", shapes.area());
