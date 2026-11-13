console.log(globalThis.probe());
const sensor = require("./sensor.cjs");
globalThis.shown = sensor.level;
