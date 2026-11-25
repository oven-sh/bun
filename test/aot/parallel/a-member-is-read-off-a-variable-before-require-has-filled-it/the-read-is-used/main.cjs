process.on("uncaughtException", error => console.log(error.constructor.name));
console.log("start");
var used = shapes.area;
var shapes = require("./shapes.mjs");
console.log("end", shapes.area(), typeof used);
