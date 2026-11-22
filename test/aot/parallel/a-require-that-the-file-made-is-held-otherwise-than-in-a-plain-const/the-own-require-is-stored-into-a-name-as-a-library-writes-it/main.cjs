"use strict";
const jukebox = require("./jukebox/index.js");
console.log(jukebox.sing("hum", process.argv[2] ?? "rain"), "|", jukebox.sing("wind", "snow", "rain"));
