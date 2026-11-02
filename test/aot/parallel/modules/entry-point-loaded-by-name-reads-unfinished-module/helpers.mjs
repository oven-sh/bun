console.log("helpers begins");
require("./drains.mjs");
export var config = { port: Number(process.env.PORT_OF_NOTHING ?? 8080), name: "service-" + (process.pid % 1) };
console.log("helpers ends");
